// v0.4 phase 1 demo: 60/40 SPY/AGG backtest driven by reconcile().
//
// Run from the repo root:
//   npx tsx scripts/v04-demo.ts
//
// Wire-up:
//   - DataFeed       : CSV-backed, reads scripts/data/{SPY,AGG}.csv
//   - Calendar       : NYSEExchangeCalendar (NYSE business days)
//   - Executor       : BacktestExecutor with 5 bps slippage, $0.005/share
//   - Strategy       : reconcile() to a fixed 60/40 target every session
//
// To regenerate the synthetic CSVs with a different seed/range,
// edit and re-run scripts/data/generate-bars.mjs.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBacktest, reconcile, type Strategy } from '../src/strategy';
import { NYSEExchangeCalendar } from '../src/calendars';
import { MemoryFeatureCache, BacktestExecutor } from '../src/reference';
import type { Asset, Bar, DataFeed } from '../src/interfaces';
import type { Portfolio } from '../src/portfolio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');

// ---------------------------------------------------------------------------
// CSV loader (cached per symbol)
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

function findBarOnOrBefore(symbol: string, t: Date): Bar | undefined {
  const bars = getBars(symbol);
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i]!;
    if (b.t.getTime() <= t.getTime()) return b;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// DataFeed adapter
// ---------------------------------------------------------------------------

const csvDataFeed: DataFeed = {
  bars: async function* (asset, range, _freq) {
    for (const bar of getBars(asset.symbol)) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// Bridge for BacktestExecutor: next bar's open after t.
async function nextOpen(asset: Asset, t: Date): Promise<{ t: Date; price: number }> {
  const bars = getBars(asset.symbol);
  const next = bars.find((b) => b.t.getTime() > t.getTime());
  if (!next) {
    throw new Error(`nextOpen: no bar after ${t.toISOString()} for ${asset.symbol} — extend the CSV range.`);
  }
  return { t: next.t, price: next.open };
}

// ---------------------------------------------------------------------------
// Strategy: 60% SPY / 40% AGG, reconciled every session.
// ---------------------------------------------------------------------------

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };
const AGG: Asset = { kind: 'equity', id: 'us:AGG', symbol: 'AGG' };

const TARGETS = new Map([
  ['us:SPY', 0.6],
  ['us:AGG', 0.4],
]);

const strategy: Strategy = {
  universe: () => [SPY, AGG],
  features: () => ({}),
  build: (_features, portfolio, t) => {
    const spyBar = findBarOnOrBefore('SPY', t);
    const aggBar = findBarOnOrBefore('AGG', t);
    if (!spyBar || !aggBar) return [];
    const prices = new Map<string, number>([
      ['us:SPY', spyBar.close],
      ['us:AGG', aggBar.close],
    ]);
    return reconcile(TARGETS, portfolio, prices);
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
  // `to` is exclusive. Each session needs a *next* bar for BacktestExecutor.nextOpen,
  // so end before the last bar in the CSVs (which run through 2025-03-31).
  range: { from: new Date('2025-01-02T00:00:00Z'), to: new Date('2025-03-31T00:00:00Z') },
  initialPortfolio: initial,
  dataFeed: csvDataFeed,
  executor,
  calendar,
  featureCache: new MemoryFeatureCache(),
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const finalT = result.finalPortfolio.t;
const lastSpy = findBarOnOrBefore('SPY', finalT)?.close ?? 0;
const lastAgg = findBarOnOrBefore('AGG', finalT)?.close ?? 0;

let mark = result.finalPortfolio.cash;
for (const p of result.finalPortfolio.positions) {
  const px = p.asset.symbol === 'SPY' ? lastSpy : lastAgg;
  mark += p.quantity * px;
}

const totalFills = result.snapshots.reduce((n, s) => n + s.fills.length, 0);

console.log('--- v0.4 phase 1 demo: 60/40 SPY/AGG ---');
console.log(`sessions       : ${result.snapshots.length}`);
console.log(`fills          : ${totalFills}`);
console.log(`final cash     : $${result.finalPortfolio.cash.toFixed(2)}`);
console.log('positions:');
for (const p of result.finalPortfolio.positions) {
  const px = p.asset.symbol === 'SPY' ? lastSpy : lastAgg;
  const mv = p.quantity * px;
  console.log(
    `  ${p.asset.symbol.padEnd(4)} qty=${p.quantity.toString().padStart(4)}  ` +
      `basis=$${p.basis.toFixed(2).padStart(10)}  mark=$${mv.toFixed(2).padStart(10)}`,
  );
}
console.log(`portfolio mark : $${mark.toFixed(2)}`);
console.log(`return         : ${((mark / 100_000 - 1) * 100).toFixed(2)}%`);

console.log('\nfirst 3 sessions:');
for (const s of result.snapshots.slice(0, 3)) {
  console.log(`  ${s.t.toISOString().slice(0, 10)}  orders=${s.orders.length}  fills=${s.fills.length}`);
}
console.log('last 3 sessions:');
for (const s of result.snapshots.slice(-3)) {
  console.log(`  ${s.t.toISOString().slice(0, 10)}  orders=${s.orders.length}  fills=${s.fills.length}`);
}
