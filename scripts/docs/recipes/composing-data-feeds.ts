// Recipe: Composing data feeds with RoutingDataFeed
//
// Tactical/v1 strategies often need data from more than one vendor —
// equity bars from one source (e.g. Yahoo) and macro time series from
// another (e.g. FRED). This recipe shows how to wire them together via
// `RoutingDataFeed`, which dispatches each `bars()` call to the right
// inner feed based on `asset.kind`.
//
// The strategy is a single-yield gate: when the 10-year Treasury yield
// (FRED series DGS10) is above 4.5%, allocate 100% to TLT; otherwise
// 100% to SPY. Rebalance monthly.
//
// In production you'd use:
//   const equity = new YfinanceDataFeed();
//   const macro  = new FredDataFeed({ apiKey: process.env.FRED_API_KEY! });
// This script substitutes hand-written synthetic feeds so it runs offline.
//
//   npx tsx scripts/docs/recipes/composing-data-feeds.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
  RoutingDataFeed,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// --- 1. Assets ------------------------------------------------------------

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const TLT = { id: 'us:TLT', symbol: 'TLT' };
// Macro asset — annotated with `kind: 'macro'` so the dialect resolves it to
// a MacroAsset, and RoutingDataFeed sends it to the macro inner feed.
const DGS10 = { kind: 'macro' as const, id: 'DGS10', symbol: '10Y Treasury' };

// --- 2. Strategy spec -----------------------------------------------------
//
// Rule tree: a single if/else gate on the 10y yield.
//   dgs10_yield > 4.5  →  100% TLT
//   else               →  100% SPY

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, TLT, DGS10],
  rebalance: { frequency: 'Monthly' },
  features: [{ id: 'dgs10_yield', kind: 'price', asset: DGS10 }],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'dgs10_yield' }, right: 4.5 },
    then: { op: 'allocate', weights: { 'us:TLT': 1.0 } },
    else: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
  },
};

// --- 3. Synthetic equity feed --------------------------------------------

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeEquityBars(start: Date, days: number, basePrice: number, drift: number, phase: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price = price * (1 + drift + Math.sin((i + phase) / 12) * 0.006);
    bars.push({ t, open: price, high: price * 1.006, low: price * 0.994, close: price, volume: 800_000 });
  }
  return bars;
}

const EQUITY_FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeEquityBars(utc('2022-01-03'), 900, 450, 0.0004, 0),
  'us:TLT': makeEquityBars(utc('2022-01-03'), 900, 95, -0.0001, 30),
};

const equityFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = EQUITY_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-data-feeds: no equity fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// --- 4. Synthetic macro feed ---------------------------------------------
//
// DGS10 oscillates between roughly 3.8% and 5.0% with a ~6-month cycle.
// Crosses 4.5% in both directions during a 1-year window so the recipe
// shows the yield-gate triggering both branches of the rule tree.

function makeMacroBars(start: Date, days: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    const yieldValue = 4.4 + Math.sin(i / 60) * 0.6;
    bars.push({ t, open: yieldValue, high: yieldValue, low: yieldValue, close: yieldValue, volume: 0 });
  }
  return bars;
}

const MACRO_FIXTURES: Record<string, Bar[]> = {
  DGS10: makeMacroBars(utc('2022-01-03'), 900),
};

const macroFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = MACRO_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-data-feeds: no macro fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// --- 5. Compose with RoutingDataFeed --------------------------------------

const dataFeed = new RoutingDataFeed({
  equity: equityFeed,
  macro: macroFeed,
});

// --- 6. Runtime -----------------------------------------------------------

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-04-01') };
// Give FeatureRuntime the full fixture window so price features have history.
const runtimeRange: DateRange = { from: utc('2022-01-03'), to: utc('2024-08-01') };

const runtime = new FeatureRuntime({ dataFeed, featureCache, range: runtimeRange, freq: '1d' });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset: Asset, t: Date) => {
    // Only equity assets are ever traded by this strategy.
    const bars = EQUITY_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-data-feeds: no fill fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`composing-data-feeds: no bar after ${t.toISOString()} for ${asset.id}`);
    return { t: next.t, price: next.open };
  },
});

// --- 7. Run ---------------------------------------------------------------

const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

// --- 8. Print summary -----------------------------------------------------

const sessions = result.snapshots.length;
const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
const tltSessions = result.snapshots.filter((s) =>
  s.portfolio.positions.some((p) => p.asset.id === 'us:TLT' && p.quantity > 0),
).length;
const spySessions = result.snapshots.filter((s) =>
  s.portfolio.positions.some((p) => p.asset.id === 'us:SPY' && p.quantity > 0),
).length;
const final = result.snapshots.at(-1);
// Position.basis is the total cost basis of the position (fill price * shares + fees),
// not per-share. We sum it to estimate invested capital. This is a cost-basis estimate,
// not mark-to-market — for an exact NAV the strategy would need to mark each position
// against the latest available bar.
const investedBasis = (final?.portfolio.positions ?? []).reduce((sum, p) => sum + p.basis, 0);
const investedCash = (final?.portfolio.cash ?? 0) + investedBasis;

console.log('=== composing-data-feeds recipe ===');
console.log(`sessions             : ${sessions}`);
console.log(`rebalances           : ${rebalances}`);
console.log(`SPY sessions         : ${spySessions}  (yield <= 4.5% -- risk-on)`);
console.log(`TLT sessions         : ${tltSessions}  (yield > 4.5% -- defensive)`);
console.log(`final cash           : $${(final?.portfolio.cash ?? 0).toFixed(2)}`);
console.log(`final position basis : $${investedBasis.toFixed(2)}`);
console.log(`cash + basis         : $${investedCash.toFixed(2)}`);
