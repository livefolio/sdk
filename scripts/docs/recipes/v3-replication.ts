// Recipe: Replicating a v0.3 strategy in v0.4
//
// Demonstrates how to express a classic v0.3 fluent-API strategy as a
// plain-data TacticalSpec. The spec below is the exact canonical parity
// spec from parity/src/strategy.ts (PARITY_SPEC) — SPY/QQQ/IEF with a
// 200-day SMA trend filter.
//
//   npx tsx scripts/docs/recipes/v3-replication.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// --- 1. The v0.4 spec — a 1:1 translation of the v0.3 fluent strategy -----
//
// v0.3 used a builder API:
//   const spy    = client.ticker('SPY')
//   const trend  = client.gt(client.price(spy), client.sma(spy, 200))
//   const hold   = client.strategy({ freq: 'Weekly', rules: [...] })
//
// v0.4 expresses the same logic as plain data. No builder, no closures.

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, QQQ, IEF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma200', kind: 'sma', asset: SPY, period: 200 },
  ],
  rules: {
    op: 'if',
    // When SPY is above its 200-day SMA → aggressive risk-on allocation
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma200' } },
    then: { op: 'allocate', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
    // Otherwise → 100% bonds (defensive)
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};

// --- 2. Synthetic in-memory DataFeed -------------------------------------
// We generate 800 weekdays of price data with a gentle upward drift for
// SPY/QQQ and a near-flat curve for IEF (bonds proxy). The SMA-200 needs
// at least 200 bars of history, so the fixture is intentionally longer than
// the backtest window.

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(start: Date, days: number, basePrice: number, drift: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    const dow = t.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    price = price * (1 + drift + Math.sin(i / 10) * 0.004);
    bars.push({ t, open: price, high: price * 1.005, low: price * 0.995, close: price, volume: 1_000_000 });
  }
  return bars;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-01-03'), 800, 450, 0.0004),
  'us:QQQ': makeBars(utc('2022-01-03'), 800, 360, 0.0006),
  'us:IEF': makeBars(utc('2022-01-03'), 800, 100, 0.00003),
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

// --- 3. Wire runtime layers ----------------------------------------------

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
// The backtest range is the window we simulate over.
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-01-01') };
// FeatureRuntime needs a wider range so SMA(200) has enough warmup bars.
// Starting from 2022-01-03 gives ~300 trading days of history before range.from.
const runtimeRange: DateRange = { from: utc('2022-01-03'), to: utc('2024-03-01') };

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

// --- 4. Hydrate spec → Strategy → runBacktest ----------------------------

const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

// --- 5. Print summary ----------------------------------------------------

const sessions = result.snapshots.length;
const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
const final = result.snapshots.at(-1);
const totalValue =
  (final?.portfolio.cash ?? 0) + (final?.portfolio.positions ?? []).reduce((sum, p) => sum + p.quantity * p.basis, 0);

console.log('=== v3-replication recipe ===');
console.log(`sessions      : ${sessions}`);
console.log(`rebalances    : ${rebalances}`);
console.log(`final cash    : $${(final?.portfolio.cash ?? 0).toFixed(2)}`);
console.log(`est. nav      : $${totalValue.toFixed(2)}`);
console.log('positions:');
for (const p of final?.portfolio.positions ?? []) {
  console.log(`  ${p.asset.symbol.padEnd(4)} qty=${p.quantity} basis=$${p.basis.toFixed(2)}`);
}
