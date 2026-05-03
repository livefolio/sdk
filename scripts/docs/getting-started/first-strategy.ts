// Quick-start: build a tactical strategy, run a backtest, print the final
// portfolio. Self-contained — uses an in-memory synthetic DataFeed so the
// sample runs without any external service. The same code shape works
// against a real adapter (e.g. @livefolio/yfinance) — only the
// `dataFeed` parameter changes.
//
//   npx tsx scripts/docs/getting-started/first-strategy.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// --- 1. Define the strategy as a TacticalSpec ---------------------------

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, QQQ, IEF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma100', kind: 'sma', asset: SPY, period: 100 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma100' } },
    then: { op: 'allocate', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};

// --- 2. Build a DataFeed ------------------------------------------------
// In production you'd use @livefolio/yfinance or your own adapter.
// Here we synthesize bars so the sample is self-contained.

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(start: Date, days: number, basePrice: number, drift: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    const dow = t.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    price = price * (1 + drift + Math.sin(i / 8) * 0.005);
    bars.push({ t, open: price, high: price * 1.005, low: price * 0.995, close: price, volume: 1_000_000 });
  }
  return bars;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2023-01-02'), 800, 400, 0.0005),
  'us:QQQ': makeBars(utc('2023-01-02'), 800, 300, 0.0007),
  'us:IEF': makeBars(utc('2023-01-02'), 800, 100, 0.00005),
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

// --- 3. Wire the runtime layers -----------------------------------------

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: utc('2023-06-01'), to: utc('2024-12-01') };

const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset, t) => {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`no bar after ${t.toISOString()} for ${asset.id}`);
    return { t: next.t, price: next.open };
  },
});

// --- 4. Hydrate the spec into a Strategy and run ------------------------

const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

// --- 5. Inspect the result ---------------------------------------------

const sessions = result.snapshots.length;
const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
const finalSnapshot = result.snapshots.at(-1);

console.log(`sessions      : ${sessions}`);
console.log(`rebalances    : ${rebalances}`);
console.log(`final cash    : $${finalSnapshot?.portfolio.cash.toFixed(2)}`);
console.log('positions:');
for (const p of finalSnapshot?.portfolio.positions ?? []) {
  console.log(`  ${p.asset.symbol.padEnd(4)} qty=${p.quantity} basis=$${p.basis.toFixed(2)}`);
}
