// Recipe: Backtest with realistic slippage and fees
//
// Shows how to configure BacktestExecutor with non-zero slippage and
// per-share fees, then compares a high-turnover Daily-rebalance strategy
// run twice:
//   - Run A: zero slippage, zero fees (default)
//   - Run B: 10 bps slippage + $0.01/share fee (realistic retail)
//
// The difference in final NAV reveals the drag that execution costs impose
// on a strategy that trades frequently.
//
//   npx tsx scripts/docs/recipes/realistic-slippage.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// --- 1. High-turnover strategy: Daily rebalance, SMA(10) crossover --------
//
// A short-period SMA and Daily frequency means the strategy rebalances on
// many trading days, accumulating slippage costs quickly.

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const SHY = { id: 'us:SHY', symbol: 'SHY' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, SHY],
  rebalance: { frequency: 'Daily' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma10', kind: 'sma', asset: SPY, period: 10 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma10' } },
    then: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    else: { op: 'allocate', weights: { 'us:SHY': 1.0 } },
  },
};

// --- 2. Synthetic DataFeed -----------------------------------------------
//
// SPY oscillates with short-period swings so the SMA(10) signal fires often,
// creating many trades. SHY is near-flat (defensive asset).

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(start: Date, days: number, basePrice: number, drift: number, period: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price = price * (1 + drift + Math.sin(i / period) * 0.007);
    bars.push({ t, open: price, high: price * 1.005, low: price * 0.995, close: price, volume: 2_000_000 });
  }
  return bars;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-06-01'), 600, 400, 0.0003, 5),
  'us:SHY': makeBars(utc('2022-06-01'), 600, 80, 0.00003, 30),
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

// --- 3. Shared helpers ----------------------------------------------------

const calendar = new NYSEExchangeCalendar();
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-04-01') };

const nextOpen = async (asset: Asset, t: Date) => {
  const bars = FIXTURES[asset.id];
  if (!bars) throw new Error(`no fixture for ${asset.id}`);
  const next = bars.find((b) => b.t.getTime() > t.getTime());
  if (!next) throw new Error(`no bar after ${t.toISOString()} for ${asset.id}`);
  return { t: next.t, price: next.open };
};

// Helper: build a fresh runtime + strategy for each run (caches are per-run)
async function runScenario(label: string, slippageBps: number, perShareFee: number) {
  const featureCache = new MemoryFeatureCache();
  const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });
  const executor = new BacktestExecutor({ calendar, nextOpen, slippageBps, perShareFee });
  const strategy = fromSpec(spec, { runtime, calendar });

  const result = await runBacktest({
    strategy,
    range,
    initialPortfolio: { cash: 100_000, positions: [], t: range.from },
    dataFeed,
    executor,
    calendar,
  });

  const sessions = result.snapshots.length;
  const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
  const final = result.snapshots.at(-1);
  // Position.basis is the total cost basis of the position (already quantity * price + fees),
  // not per-share. Sum it directly for invested capital. Cost-basis estimate, not
  // mark-to-market — but that's fine for the slippage comparison since slippage shows up as
  // higher entry-cost basis in the costs run vs. the ideal run.
  const investedBasis = (final?.portfolio.positions ?? []).reduce((sum, p) => sum + p.basis, 0);
  const cashPlusBasis = (final?.portfolio.cash ?? 0) + investedBasis;

  console.log(`\n--- ${label} ---`);
  console.log(`  slippage     : ${slippageBps} bps`);
  console.log(`  per-share fee: $${perShareFee.toFixed(3)}`);
  console.log(`  sessions     : ${sessions}`);
  console.log(`  rebalances   : ${rebalances}`);
  console.log(`  final cash   : $${(final?.portfolio.cash ?? 0).toFixed(2)}`);
  console.log(`  cash + basis : $${cashPlusBasis.toFixed(2)}`);

  return cashPlusBasis;
}

// --- 4. Run both scenarios and compare ------------------------------------

console.log('=== realistic-slippage recipe ===');
const idealValue = await runScenario('Run A — zero costs (default)', 0, 0);
const realValue = await runScenario('Run B — realistic costs (10 bps + $0.01/share)', 10, 0.01);

const drag = idealValue - realValue;
const dragPct = (drag / idealValue) * 100;

console.log('\n=== comparison ===');
console.log(`  cash + basis (no costs)  : $${idealValue.toFixed(2)}`);
console.log(`  cash + basis (with costs): $${realValue.toFixed(2)}`);
console.log(`  execution drag           : $${drag.toFixed(2)} (${dragPct.toFixed(2)}% of gross)`);
