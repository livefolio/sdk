// v0.4 phase 2 demo: SMA(20) trend-following on SPY.
//
// Run from the repo root:
//   npx tsx scripts/v04-demo-sma.ts
//
// What this exercises (beyond phase 1's reconcile-only demo):
//   - FeatureRuntime: computes SMA(20) and price features over SPY, cached
//     in MemoryFeatureCache. The underlying bars fetch is memoized, so two
//     features over the same asset share one CSV scan.
//   - async Strategy.features(): awaits both feature computations via
//     Promise.all, then reads the value at the current session via seriesAt.
//   - Strategy.build(): goes 100% SPY when price > SMA(20), else holds cash.
//
// The first 20 sessions sit in cash (SMA undefined during warmup), which is
// expected — you'll see it in the per-session log.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FeatureRuntime, seriesAt } from '../src/features';
import { runBacktest, reconcile, type Strategy } from '../src/strategy';
import { NYSEExchangeCalendar } from '../src/calendars';
import { MemoryFeatureCache, BacktestExecutor } from '../src/reference';
import type { Asset, Bar, DataFeed } from '../src/interfaces';
import type { Portfolio } from '../src/portfolio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');

// ---------------------------------------------------------------------------
// CSV loader
// ---------------------------------------------------------------------------

function loadBars(symbol: string): Bar[] {
  const path = join(DATA_DIR, `${symbol}.csv`);
  const text = readFileSync(path, 'utf-8');
  const lines = text.trim().split('\n').slice(1);
  return lines.map((line) => {
    const [date, open, high, low, close, volume] = line.split(',');
    return {
      t: new Date(`${date}T00:00:00Z`),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
  });
}

const barCache = new Map<string, Bar[]>();
function getBars(symbol: string): Bar[] {
  let bars = barCache.get(symbol);
  if (!bars) {
    bars = loadBars(symbol);
    barCache.set(symbol, bars);
  }
  return bars;
}

// ---------------------------------------------------------------------------
// DataFeed adapter (instrumented to count calls)
// ---------------------------------------------------------------------------

let barsCallCount = 0;
const csvDataFeed: DataFeed = {
  bars: async function* (asset, range, _freq) {
    barsCallCount++;
    for (const bar of getBars(asset.symbol)) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

async function nextOpen(asset: Asset, t: Date): Promise<{ t: Date; price: number }> {
  const bars = getBars(asset.symbol);
  const next = bars.find((b) => b.t.getTime() > t.getTime());
  if (!next) {
    throw new Error(`nextOpen: no bar after ${t.toISOString()} for ${asset.symbol} — extend the CSV range.`);
  }
  return { t: next.t, price: next.open };
}

// ---------------------------------------------------------------------------
// Strategy: 100% SPY when price > SMA(20), else cash.
// ---------------------------------------------------------------------------

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };

const range = { from: new Date('2025-01-02T00:00:00Z'), to: new Date('2025-03-31T00:00:00Z') };
const cache = new MemoryFeatureCache();
const runtime = new FeatureRuntime({ dataFeed: csvDataFeed, featureCache: cache, range, freq: '1d' });

const strategy: Strategy<{ price?: number; sma?: number }> = {
  universe: () => [SPY],
  features: async (_u, _p, t) => {
    const [priceSeries, smaSeries] = await Promise.all([
      runtime.compute({ kind: 'price' }, SPY),
      runtime.compute({ kind: 'sma', period: 20 }, SPY),
    ]);
    return {
      price: seriesAt(priceSeries, t),
      sma: seriesAt(smaSeries, t),
    };
  },
  build: (f, portfolio) => {
    if (f.price === undefined) return [];
    const target = f.sma !== undefined && f.price > f.sma ? new Map([['us:SPY', 1]]) : new Map<string, number>();
    const prices = new Map([['us:SPY', f.price]]);
    return reconcile(target, portfolio, prices);
  },
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const calendar = new NYSEExchangeCalendar();
const executor = new BacktestExecutor({
  calendar,
  nextOpen,
  slippageBps: 5,
  perShareFee: 0.005,
});

const initial: Portfolio = {
  cash: 100_000,
  positions: [],
  t: new Date('2025-01-02T00:00:00Z'),
};

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: initial,
  dataFeed: csvDataFeed,
  executor,
  calendar,
  featureCache: cache,
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const finalT = result.finalPortfolio.t;
const spyBars = getBars('SPY');
const lastSpyBar = [...spyBars].reverse().find((b) => b.t.getTime() <= finalT.getTime());
const lastSpy = lastSpyBar?.close ?? 0;

let mark = result.finalPortfolio.cash;
for (const p of result.finalPortfolio.positions) {
  mark += p.quantity * lastSpy;
}

const totalFills = result.snapshots.reduce((n, s) => n + s.fills.length, 0);
const sessionsHoldingSpy = result.snapshots.filter((s) => s.portfolio.positions.length > 0).length;

// Buy-and-hold baseline for comparison.
const firstOpen = spyBars[0]?.open ?? 0;
const bhShares = Math.floor(100_000 / firstOpen);
const bhCash = 100_000 - bhShares * firstOpen;
const bhMark = bhCash + bhShares * lastSpy;

console.log('--- v0.4 phase 2 demo: SPY trend-follow (price > SMA(20)) ---');
console.log(`sessions          : ${result.snapshots.length}`);
console.log(`sessions long SPY : ${sessionsHoldingSpy}`);
console.log(`sessions in cash  : ${result.snapshots.length - sessionsHoldingSpy}`);
console.log(`fills             : ${totalFills}`);
console.log(`DataFeed.bars calls: ${barsCallCount}  (memoization: 1 per asset)`);
console.log(`final cash        : $${result.finalPortfolio.cash.toFixed(2)}`);
console.log('positions:');
for (const p of result.finalPortfolio.positions) {
  const mv = p.quantity * lastSpy;
  console.log(
    `  ${p.asset.symbol.padEnd(4)} qty=${p.quantity.toString().padStart(4)}  ` +
      `basis=$${p.basis.toFixed(2).padStart(10)}  mark=$${mv.toFixed(2).padStart(10)}`,
  );
}
console.log(`strategy mark     : $${mark.toFixed(2)}  (${((mark / 100_000 - 1) * 100).toFixed(2)}%)`);
console.log(`buy-and-hold mark : $${bhMark.toFixed(2)}  (${((bhMark / 100_000 - 1) * 100).toFixed(2)}%)`);

console.log('\nsignal trace (last 10 sessions):');
for (const s of result.snapshots.slice(-10)) {
  const date = s.t.toISOString().slice(0, 10);
  const held = s.portfolio.positions.length > 0 ? 'LONG' : 'CASH';
  console.log(`  ${date}  ${held}  orders=${s.orders.length}  fills=${s.fills.length}`);
}
