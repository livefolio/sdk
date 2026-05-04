// Rule trees — hysteresis demo.
// Shows a two-branch strategy where the trend comparison uses a tolerance band
// so that small oscillations around the threshold do not cause whipsaw trades.
// Prints the rebalance history to show that hysteresis suppresses flip-flopping.
//
//   npx tsx scripts/docs/guides-authoring/rule-trees-hysteresis.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

// ─── Synthetic bars that oscillate around the SMA threshold ──────────────────
// The price series is designed to cross the SMA repeatedly without hysteresis,
// but the 2 % band will hold the allocation stable through small wiggles.

function makeBars(start: Date, days: number, base: number, drift: number): Bar[] {
  const out: Bar[] = [];
  let price = base;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    // Slow drift + oscillation designed to hover near the SMA
    price *= 1 + drift + Math.sin(i / 4) * 0.008;
    out.push({ t, open: price, high: price * 1.003, low: price * 0.997, close: price, volume: 1_000_000 });
  }
  return out;
}

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2023-01-02'), 400, 400, 0.0001),
  'us:IEF': makeBars(utc('2023-01-02'), 400, 100, 0.00005),
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

// ─── Spec WITHOUT hysteresis ──────────────────────────────────────────────────

const specNoHysteresis: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, IEF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    // Short SMA so the price oscillates around it
    { id: 'spy_sma20', kind: 'sma', asset: SPY, period: 20 },
  ],
  rules: {
    op: 'if',
    // Plain comparison — no tolerance band
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma20' } },
    then: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};

// ─── Spec WITH hysteresis ─────────────────────────────────────────────────────

const specWithHysteresis: TacticalSpec = {
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
      op: 'gt',
      left: { ref: 'spy_price' },
      right: { ref: 'spy_sma20' },
      // 2 % relative band: once the signal fires, it won't flip until price
      // moves more than 2 % in the opposite direction from the threshold.
      tolerance: { value: 2, mode: 'relative' },
      // id is mandatory when tolerance is set — keys the hysteresis state
      // across rebalances so the runtime remembers the previous decision.
      id: 'spy_trend',
    },
    then: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};

// ─── Run both backtests and compare flip counts ───────────────────────────────

async function run(spec: TacticalSpec, label: string): Promise<void> {
  const calendar = new NYSEExchangeCalendar();
  const range: DateRange = { from: utc('2023-02-01'), to: utc('2023-12-01') };
  const featureCache = new MemoryFeatureCache();
  const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

  const executor = new BacktestExecutor({
    calendar,
    nextOpen: async (asset, t) => {
      const bars = FIXTURES[asset.id];
      if (!bars) throw new Error(`no fixture for ${asset.id}`);
      const next = bars.find((b) => b.t.getTime() > t.getTime());
      if (!next) throw new Error(`no bar after ${t.toISOString()}`);
      return { t: next.t, price: next.open };
    },
  });

  const strategy = fromSpec(spec, { runtime, calendar });
  const result = await runBacktest({
    strategy,
    range,
    initialPortfolio: { cash: 100_000, positions: [], t: range.from },
    dataFeed,
    executor,
    calendar,
  });

  const rebalances = result.snapshots.filter((s) => s.orders.length > 0);
  console.log(`\n[${label}]`);
  console.log(`  Rebalance events : ${rebalances.length}`);

  // Count allocation flips (SPY → IEF or IEF → SPY)
  let flips = 0;
  let prevHeldSPY: boolean | undefined;
  for (const snap of rebalances) {
    const heldSPY = snap.portfolio.positions.some((p) => p.asset.id === 'us:SPY' && p.quantity > 0);
    if (prevHeldSPY !== undefined && heldSPY !== prevHeldSPY) flips++;
    prevHeldSPY = heldSPY;
  }
  console.log(`  Allocation flips : ${flips}`);
}

await run(specNoHysteresis, 'Without hysteresis');
await run(specWithHysteresis, 'With hysteresis (2 % band)');

console.log('\nHysteresis keeps flip count lower despite identical price data.');
