// Recipe: Mean-reversion with hysteresis
//
// Demonstrates a mean-reversion entry/exit using price vs SMA with a
// hysteresis band (Tolerance). The strategy allocates 100% to SPY when its
// price drops more than 3% below its SMA(20) — suggesting oversold conditions
// — and stays in IEF (bonds) otherwise. Hysteresis prevents rapid whipsaw:
// once allocated to SPY it stays there until the price recovers above the SMA,
// and vice versa.
//
// Key concepts:
//   - `op: 'lt'` comparison to detect price < SMA
//   - `tolerance: { value: 3, mode: 'relative' }` — 3% hysteresis band
//   - Comparison `id` required when tolerance is set
//   - Counting rebalance events shows how hysteresis reduces churn
//
//   npx tsx scripts/docs/recipes/mean-reversion.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// --- 1. Assets ------------------------------------------------------------

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

// --- 2. Mean-reversion spec with hysteresis ------------------------------
//
// Signal: SPY price < SMA(20). We use op:'lt' so the condition is true when
// the price is BELOW the SMA (mean-reversion entry). The tolerance band of
// 3% relative means: once in SPY, stay there until price > SMA * 1.03.
//
// NOTE: tolerance requires a stable `id` on the comparison so the engine
// can persist the last-seen outcome across weekly rebalance steps.

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, IEF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma20', kind: 'sma', asset: SPY, period: 20 },
  ],
  rules: {
    op: 'if',
    cond: {
      id: 'spy_below_sma', // required when tolerance is set
      op: 'lt',
      left: { ref: 'spy_price' },
      right: { ref: 'spy_sma20' },
      // Hysteresis: flip from IEF→SPY only when price is 3% below SMA;
      // flip back SPY→IEF only when price is 3% above SMA.
      tolerance: { value: 3, mode: 'relative' },
    },
    // price < SMA(20) by more than 3% → buy the dip
    then: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    // price above the band → hold bonds
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};

// --- 3. Synthetic DataFeed with oscillating prices -----------------------
//
// The SPY price oscillates around a gentle upward trend with larger
// amplitude swings so the mean-reversion signal fires several times per year.
// IEF is nearly flat (bonds proxy).

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(start: Date, days: number, basePrice: number, drift: number, amplitude: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    // Trend + oscillation
    price = price * (1 + drift) + Math.sin(i / 6) * amplitude;
    if (price <= 0) price = 1;
    bars.push({ t, open: price, high: price * 1.006, low: price * 0.994, close: price, volume: 1_200_000 });
  }
  return bars;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-06-01'), 700, 400, 0.0003, 6), // oscillates ±6pts around trend
  'us:IEF': makeBars(utc('2022-06-01'), 700, 100, 0.00004, 0.1),
};

const dataFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// --- 4. Runtime -----------------------------------------------------------

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: utc('2023-06-01'), to: utc('2024-06-01') };

const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset: Asset, t: Date) => {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`no bar after ${t.toISOString()} for ${asset.id}`);
    return { t: next.t, price: next.open };
  },
});

// --- 5. Run ---------------------------------------------------------------

const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

// --- 6. Print summary with regime-flip analysis --------------------------

const sessions = result.snapshots.length;
const rebalanceSessions = result.snapshots.filter((s) => s.orders.length > 0);
const rebalances = rebalanceSessions.length;
const final = result.snapshots.at(-1);
// Position.basis is the total cost basis of the position (already quantity * price + fees),
// not per-share. Sum it directly for invested capital. Cost-basis estimate, not mark-to-market.
const investedBasis = (final?.portfolio.positions ?? []).reduce((sum, p) => sum + p.basis, 0);
const cashPlusBasis = (final?.portfolio.cash ?? 0) + investedBasis;

// Count regime flips (transitions between SPY and IEF allocation)
let flips = 0;
let prevAsset: string | null = null;
for (const snap of result.snapshots) {
  const dominant = snap.portfolio.positions[0]?.asset.symbol ?? 'CASH';
  if (prevAsset !== null && dominant !== prevAsset) flips++;
  prevAsset = dominant;
}

console.log('=== mean-reversion recipe ===');
console.log(`sessions         : ${sessions}`);
console.log(`rebalances       : ${rebalances}`);
console.log(`regime flips     : ${flips}  (hysteresis reduces whipsaw)`);
console.log(`final cash       : $${(final?.portfolio.cash ?? 0).toFixed(2)}`);
console.log(`cash + basis     : $${cashPlusBasis.toFixed(2)}`);
console.log('final positions:');
for (const p of final?.portfolio.positions ?? []) {
  console.log(`  ${p.asset.symbol.padEnd(4)} qty=${p.quantity} basis=$${p.basis.toFixed(2)}`);
}
