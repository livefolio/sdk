// Recipe: Multi-asset trend-following
//
// Demonstrates a SMA-crossover trend filter across 4 assets (SPY, QQQ,
// GLD, TLT). Each asset is evaluated independently: if its price is above
// its SMA(50), it qualifies for allocation. Qualified assets share equal
// weight; if none qualify the strategy falls back to a cash-like position
// in SHY (short-term Treasuries).
//
// The rule tree chains four if/else nodes — one per risky asset — each
// contributing weight when the trend is on.
//
//   npx tsx scripts/docs/recipes/multi-asset-trend.ts

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
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const GLD = { id: 'us:GLD', symbol: 'GLD' };
const TLT = { id: 'us:TLT', symbol: 'TLT' };
// Defensive fallback when no trend is active
const SHY = { id: 'us:SHY', symbol: 'SHY' };

// --- 2. Strategy spec -----------------------------------------------------
//
// Design: equal-weight among assets above their SMA(50). The rule tree is a
// binary decision tree — each IfNode adds weight for one asset when trending.
//
// For simplicity this recipe uses 4 nested branches covering all 2^4 = 16
// outcomes by relying on the innermost allocate to carry the residual weight.
//
// A more compact approach uses a single 25%/75%/100% allocate at each level:
// SPY trend on  → SPY gets 25%; recurse for remaining 75% across QQQ/GLD/TLT.
// This produces approximate equal-weight without exhaustively listing combos.

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, QQQ, GLD, TLT, SHY],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma50', kind: 'sma', asset: SPY, period: 50 },
    { id: 'qqq_price', kind: 'price', asset: QQQ },
    { id: 'qqq_sma50', kind: 'sma', asset: QQQ, period: 50 },
    { id: 'gld_price', kind: 'price', asset: GLD },
    { id: 'gld_sma50', kind: 'sma', asset: GLD, period: 50 },
    { id: 'tlt_price', kind: 'price', asset: TLT },
    { id: 'tlt_sma50', kind: 'sma', asset: TLT, period: 50 },
  ],
  // Rule tree: cascade through assets in priority order.
  // Each IfNode checks one asset's trend; when the trend is off, fall through
  // to the next asset. If SPY is trending it anchors the allocation; QQQ, GLD,
  // and TLT each add weight when their own trend is active. The innermost
  // node falls back to SHY when no risk asset is trending.
  //
  // Allocation ladder (SPY trending → split with QQQ/GLD/TLT):
  //   SPY off                   → 100% SHY
  //   SPY on, QQQ off           → 100% SPY
  //   SPY+QQQ on, GLD off       → 50% SPY / 50% QQQ
  //   SPY+QQQ+GLD on, TLT off   → 34% SPY / 33% QQQ / 33% GLD
  //   All 4 on                  → 25% each
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma50' } },
    then: {
      op: 'if',
      cond: { op: 'gt', left: { ref: 'qqq_price' }, right: { ref: 'qqq_sma50' } },
      then: {
        op: 'if',
        cond: { op: 'gt', left: { ref: 'gld_price' }, right: { ref: 'gld_sma50' } },
        then: {
          op: 'if',
          cond: { op: 'gt', left: { ref: 'tlt_price' }, right: { ref: 'tlt_sma50' } },
          // All 4 trending: equal-weight across SPY/QQQ/GLD/TLT
          then: { op: 'allocate', weights: { 'us:SPY': 0.25, 'us:QQQ': 0.25, 'us:GLD': 0.25, 'us:TLT': 0.25 } },
          // SPY+QQQ+GLD trending, TLT not: equal-weight 3 assets
          else: { op: 'allocate', weights: { 'us:SPY': 0.34, 'us:QQQ': 0.33, 'us:GLD': 0.33 } },
        },
        // SPY+QQQ trending, GLD not: split SPY/QQQ
        else: { op: 'allocate', weights: { 'us:SPY': 0.5, 'us:QQQ': 0.5 } },
      },
      // SPY trending, QQQ not: 100% SPY
      else: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    },
    // SPY not trending — use SHY as defensive anchor
    else: { op: 'allocate', weights: { 'us:SHY': 1.0 } },
  },
};

// --- 3. Synthetic in-memory DataFeed --------------------------------------

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(start: Date, days: number, basePrice: number, drift: number, phase: number): Bar[] {
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

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-01-03'), 900, 450, 0.0004, 0),
  'us:QQQ': makeBars(utc('2022-01-03'), 900, 360, 0.0005, 5),
  'us:GLD': makeBars(utc('2022-01-03'), 900, 175, 0.0002, 10),
  'us:TLT': makeBars(utc('2022-01-03'), 900, 120, -0.0001, 15),
  'us:SHY': makeBars(utc('2022-01-03'), 900, 84, 0.00005, 20),
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
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-04-01') };
// Give the runtime the full fixture window so SMA(50) has warmup bars.
const runtimeRange: DateRange = { from: utc('2022-01-03'), to: utc('2024-08-01') };

const runtime = new FeatureRuntime({ dataFeed, featureCache, range: runtimeRange, freq: '1d' });

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

// --- 6. Print summary -----------------------------------------------------

const sessions = result.snapshots.length;
const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
const final = result.snapshots.at(-1);
const posValue = (final?.portfolio.positions ?? []).reduce((sum, p) => sum + p.quantity * p.basis, 0);
const nav = (final?.portfolio.cash ?? 0) + posValue;

console.log('=== multi-asset-trend recipe ===');
console.log(`sessions      : ${sessions}`);
console.log(`rebalances    : ${rebalances}`);
console.log(`final cash    : $${(final?.portfolio.cash ?? 0).toFixed(2)}`);
console.log(`est. nav      : $${nav.toFixed(2)}`);
console.log('final positions:');
for (const p of final?.portfolio.positions ?? []) {
  console.log(`  ${p.asset.symbol.padEnd(4)} qty=${p.quantity} basis=$${p.basis.toFixed(2)}`);
}
