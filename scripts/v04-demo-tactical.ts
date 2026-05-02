// v0.4 phase 3 demo: tactical/v0 dialect — regime-switching 60/40 with hysteresis.
//
// Run from the repo root:
//   npx tsx scripts/v04-demo-tactical.ts
//
// What this exercises:
//   - tactical/v0 dialect: the strategy is authored as a JSON-shaped TacticalSpec
//     (universe, features, rules), then hydrated via tactical.fromSpec(...) into
//     a v0.4 Strategy that runBacktest can drive. No imperative TypeScript.
//   - Hysteresis: a tolerance band on the price/SMA comparison stops the strategy
//     from flip-flopping when price hovers near the SMA. The same spec without
//     tolerance would emit twice as many rebalances on this fixture.
//   - Rebalance cadence: Weekly. fromSpec consults USEquityCalendar to decide
//     whether each session is the last session of its ISO week (Friday under
//     normal conditions). Non-rebalance days emit zero orders.
//   - Multi-asset universe: SPY + AGG. The rule allocates between regimes:
//       uptrend  → 100% SPY  (aggressive)
//       downtrend → 60% AGG / 40% SPY (defensive)
//
// The demo logs the spec, runs it via runBacktest, and compares against
// buy-and-hold SPY plus a fixed 60/40 baseline.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fromSpec, type TacticalSpec } from '../src/tactical';
import { FeatureRuntime } from '../src/features';
import { runBacktest } from '../src/strategy';
import { USEquityCalendar, MemoryFeatureCache, BacktestExecutor } from '../src/reference';
import type { Asset, Bar, DataFeed } from '../src/interfaces';
import type { Portfolio } from '../src/portfolio';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');

// ---------------------------------------------------------------------------
// CSV loader (shared by the data feed and the executor's nextOpen)
// ---------------------------------------------------------------------------

function loadBars(symbol: string): Bar[] {
  const text = readFileSync(join(DATA_DIR, `${symbol}.csv`), 'utf-8');
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
  if (!next) throw new Error(`nextOpen: no bar after ${t.toISOString()} for ${asset.symbol}`);
  return { t: next.t, price: next.open };
}

// ---------------------------------------------------------------------------
// The spec — authored as data, not code.
// ---------------------------------------------------------------------------

const SPY_REF = { id: 'us:SPY', symbol: 'SPY' };
const AGG_REF = { id: 'us:AGG', symbol: 'AGG' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY_REF, AGG_REF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY_REF },
    { id: 'spy_sma20', kind: 'sma', asset: SPY_REF, period: 20 },
  ],
  rules: {
    op: 'if',
    cond: {
      op: 'gt',
      left: { ref: 'spy_price' },
      right: { ref: 'spy_sma20' },
      tolerance: { value: 1.5, mode: 'relative' },
      id: 'spy_trend',
    },
    then: { op: 'allocate', weights: { 'us:SPY': 1 } },
    else: { op: 'allocate', weights: { 'us:SPY': 0.4, 'us:AGG': 0.6 } },
  },
};

// ---------------------------------------------------------------------------
// Wire it up.
// ---------------------------------------------------------------------------

const range = { from: new Date('2025-01-02T00:00:00Z'), to: new Date('2025-03-31T00:00:00Z') };
const calendar = new USEquityCalendar();
const cache = new MemoryFeatureCache();
const runtime = new FeatureRuntime({ dataFeed: csvDataFeed, featureCache: cache, range, freq: '1d' });

const strategy = fromSpec(spec, { runtime, calendar });

const executor = new BacktestExecutor({
  calendar,
  nextOpen,
  slippageBps: 5,
  perShareFee: 0.005,
});

const initial: Portfolio = {
  cash: 100_000,
  positions: [],
  t: range.from,
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
// Baselines for comparison.
// ---------------------------------------------------------------------------

const spyBars = getBars('SPY');
const aggBars = getBars('AGG');
const lastSpy = spyBars[spyBars.length - 1]!.close;
const lastAgg = aggBars[aggBars.length - 1]!.close;
const firstSpyOpen = spyBars[0]!.open;
const firstAggOpen = aggBars[0]!.open;

// Buy-and-hold SPY.
const bhSpyShares = Math.floor(100_000 / firstSpyOpen);
const bhSpyMark = 100_000 - bhSpyShares * firstSpyOpen + bhSpyShares * lastSpy;

// Static 60/40 (40% SPY, 60% AGG, no rebalancing).
const staticSpyShares = Math.floor((100_000 * 0.4) / firstSpyOpen);
const staticAggShares = Math.floor((100_000 * 0.6) / firstAggOpen);
const staticCash = 100_000 - staticSpyShares * firstSpyOpen - staticAggShares * firstAggOpen;
const staticMark = staticCash + staticSpyShares * lastSpy + staticAggShares * lastAgg;

// Tactical strategy mark.
let tacticalMark = result.finalPortfolio.cash;
for (const p of result.finalPortfolio.positions) {
  const px = p.asset.id === 'us:SPY' ? lastSpy : p.asset.id === 'us:AGG' ? lastAgg : 0;
  tacticalMark += p.quantity * px;
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

const sessionsWithOrders = result.snapshots.filter((s) => s.orders.length > 0).length;
const totalFills = result.snapshots.reduce((n, s) => n + s.fills.length, 0);

function pct(x: number): string {
  return ((x / 100_000 - 1) * 100).toFixed(2) + '%';
}

console.log('--- v0.4 phase 3 demo: tactical/v0 dialect ---\n');
console.log('spec:');
console.log(JSON.stringify(spec, null, 2));
console.log('');

console.log('--- run summary ---');
console.log(`sessions             : ${result.snapshots.length}`);
console.log(`rebalance days       : ${sessionsWithOrders}  (Weekly cadence — should be ≈ # of Fridays)`);
console.log(`fills                : ${totalFills}`);
console.log(`DataFeed.bars calls  : ${barsCallCount}  (1 per asset, runtime memoizes)`);

console.log('\n--- final marks ---');
console.log(`tactical (60/40 ↔ SPY) : $${tacticalMark.toFixed(2).padStart(12)}  (${pct(tacticalMark)})`);
console.log(`buy-and-hold SPY       : $${bhSpyMark.toFixed(2).padStart(12)}  (${pct(bhSpyMark)})`);
console.log(`static 60/40           : $${staticMark.toFixed(2).padStart(12)}  (${pct(staticMark)})`);

console.log('\n--- final positions ---');
for (const p of result.finalPortfolio.positions) {
  const px = p.asset.id === 'us:SPY' ? lastSpy : p.asset.id === 'us:AGG' ? lastAgg : 0;
  console.log(
    `  ${p.asset.symbol.padEnd(4)} qty=${p.quantity.toString().padStart(4)}  ` +
      `basis=$${p.basis.toFixed(2).padStart(10)}  mark=$${(p.quantity * px).toFixed(2).padStart(10)}`,
  );
}
console.log(`  cash $${result.finalPortfolio.cash.toFixed(2)}`);

console.log('\n--- signal trace (rebalance days only) ---');
for (const s of result.snapshots) {
  if (s.orders.length === 0) continue;
  const date = s.t.toISOString().slice(0, 10);
  const regime = s.portfolio.positions.some((p) => p.asset.id === 'us:AGG')
    ? 'DEFENSIVE (60/40)'
    : 'AGGRESSIVE (100% SPY)';
  console.log(`  ${date}  rebalanced → ${regime}  (${s.orders.length} order${s.orders.length === 1 ? '' : 's'})`);
}
