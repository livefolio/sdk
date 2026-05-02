// Runnable verification of the v0.4 README quick-start.
//
// Run from the repo root:
//   npx tsx scripts/v04-readme-example.ts
//
// This script exercises the same v0.4 surface the README documents
// (tactical.fromSpec → runBacktest → BacktestResult), but against an in-memory
// synthetic DataFeed instead of a market-data adapter. It proves the imports
// resolve, types align, and runBacktest produces non-empty snapshots end to
// end. The README's code block uses YfinanceDataFeed instead — verified
// separately by extracting and tsc-compiling the block.

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  USEquityCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// -----------------------------------------------------------------------
// In-memory DataFeed: synthetic price series for SPY, QQQ, IEF.
// -----------------------------------------------------------------------

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

const RANGE_START = utc('2023-01-02');
const DAYS = 800;
const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(RANGE_START, DAYS, 400, 0.0005),
  'us:QQQ': makeBars(RANGE_START, DAYS, 300, 0.0007),
  'us:IEF': makeBars(RANGE_START, DAYS, 100, 0.00005),
};

const memoryDataFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// -----------------------------------------------------------------------
// Strategy: SPY/QQQ/IEF weekly trend (the v0.4 canonical pair).
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Run.
// -----------------------------------------------------------------------

const calendar = new USEquityCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: utc('2023-06-01'), to: utc('2024-12-01') };

const runtime = new FeatureRuntime({
  dataFeed: memoryDataFeed,
  featureCache,
  range,
  freq: '1d',
});

async function nextOpen(asset: Asset, t: Date): Promise<{ t: Date; price: number }> {
  const bars = FIXTURES[asset.id];
  if (!bars) throw new Error(`no fixture for ${asset.id}`);
  const next = bars.find((b) => b.t.getTime() > t.getTime());
  if (!next) throw new Error(`no bar after ${t.toISOString()} for ${asset.id}`);
  return { t: next.t, price: next.open };
}

const executor = new BacktestExecutor({ calendar, nextOpen });
const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed: memoryDataFeed,
  executor,
  calendar,
});

// -----------------------------------------------------------------------
// Assert + report.
// -----------------------------------------------------------------------

const sessions = result.snapshots.length;
const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
const fills = result.snapshots.reduce((n, s) => n + s.fills.length, 0);
const finalSnapshot = result.snapshots.at(-1);

if (sessions === 0) throw new Error('runBacktest produced no snapshots');
if (rebalances === 0) throw new Error('strategy never rebalanced — feature warmup likely too long');
if (!finalSnapshot) throw new Error('no final snapshot');

console.log('--- v0.4 README example ---');
console.log(`sessions     : ${sessions}`);
console.log(`rebalances   : ${rebalances}`);
console.log(`fills        : ${fills}`);
console.log(`final cash   : $${finalSnapshot.portfolio.cash.toFixed(2)}`);
console.log(`positions    :`);
for (const p of finalSnapshot.portfolio.positions) {
  console.log(`  ${p.asset.symbol.padEnd(4)}  qty=${p.quantity}  basis=$${p.basis.toFixed(2)}`);
}
console.log('\nOK — runBacktest produced a populated final portfolio.');
