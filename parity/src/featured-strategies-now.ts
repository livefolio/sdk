// Live snapshot: what each of the four featured strategies would hold *right
// now* given the most recent yfinance bars. One-shot — fetches data, runs each
// backtest up to the last completed session, prints the current rule branch
// and target weights, and exits.
//
// Useful as a live smoke test: confirms the YfinanceDataFeed is reachable,
// every universe asset has fresh bars, the strategy rule trees evaluate
// without throwing, and the inferred branch matches what you'd expect from
// today's market regime.
//
//   npx tsx parity/src/featured-strategies-now.ts
//
// Companion: featured-strategies-listen.ts (long-running listener for a
// single strategy) and featured-strategies-parity.ts (historical regression).

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, AssetId, DateRange } from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';

// --- 1. Strategy specs ----------------------------------------------------

const TQQQ = { id: 'us:TQQQ', symbol: 'TQQQ' };
const SQQQ = { id: 'us:SQQQ', symbol: 'SQQQ' };
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const SPY = { id: 'us:SPY', symbol: 'SPY' };
const UPRO = { id: 'us:UPRO', symbol: 'UPRO' };
const UGL = { id: 'us:UGL', symbol: 'UGL' };
const GLD = { id: 'us:GLD', symbol: 'GLD' };
const IAU = { id: 'us:IAU', symbol: 'IAU' };
const AGG = { id: 'us:AGG', symbol: 'AGG' };
const KMLM = { id: 'us:KMLM', symbol: 'KMLM' };
const ZROZ = { id: 'us:ZROZ', symbol: 'ZROZ' };
const UUP = { id: 'us:UUP', symbol: 'UUP' };
const USMV = { id: 'us:USMV', symbol: 'USMV' };
const VTIP = { id: 'us:VTIP', symbol: 'VTIP' };
const LCSIX = { id: 'us:LCSIX', symbol: 'LCSIX' };

const goldenButterflyTactical: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [TQQQ, SQQQ, IAU, UUP, USMV, LCSIX, VTIP],
  rebalance: { frequency: 'Daily' },
  features: [
    { id: 'tqqq_rsi14', kind: 'rsi', asset: TQQQ, period: 14 },
    { id: 'tqqq_price', kind: 'price', asset: TQQQ },
    { id: 'tqqq_sma200', kind: 'sma', asset: TQQQ, period: 200 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'lt', left: { ref: 'tqqq_rsi14' }, right: 30 },
    then: { op: 'allocate', weights: { 'us:TQQQ': 1.0 } },
    else: {
      op: 'if',
      cond: { op: 'gt', left: { ref: 'tqqq_rsi14' }, right: 80 },
      then: { op: 'allocate', weights: { 'us:SQQQ': 1.0 } },
      else: {
        op: 'if',
        cond: { op: 'gt', left: { ref: 'tqqq_price' }, right: { ref: 'tqqq_sma200' } },
        then: {
          op: 'allocate',
          weights: { 'us:IAU': 0.2, 'us:UUP': 0.2, 'us:TQQQ': 0.2, 'us:USMV': 0.2, 'us:LCSIX': 0.2 },
        },
        else: {
          op: 'allocate',
          weights: { 'us:IAU': 0.2, 'us:UUP': 0.2, 'us:USMV': 0.2, 'us:VTIP': 0.2, 'us:LCSIX': 0.2 },
        },
      },
    },
  },
};

const trendRocket: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [UGL, TQQQ, UPRO, AGG, GLD, SPY],
  rebalance: { frequency: 'Daily' },
  features: [
    { id: 'spy_sma5', kind: 'sma', asset: SPY, period: 5, delay: 1 },
    { id: 'spy_sma200', kind: 'sma', asset: SPY, period: 200, delay: 1 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_sma5' }, right: { ref: 'spy_sma200' } },
    then: { op: 'allocate', weights: { 'us:UGL': 0.3334, 'us:TQQQ': 0.3333, 'us:UPRO': 0.3333 } },
    else: { op: 'allocate', weights: { 'us:AGG': 0.3334, 'us:GLD': 0.3333, 'us:SPY': 0.3333 } },
  },
};

const crisisReadyTurbo: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [UGL, KMLM, UPRO],
  rebalance: { frequency: 'Daily' },
  features: [],
  rules: { op: 'allocate', weights: { 'us:UGL': 0.33, 'us:KMLM': 0.33, 'us:UPRO': 0.34 } },
};

const leveragedMovingAverage: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [UGL, KMLM, ZROZ, TQQQ, QQQ],
  rebalance: { frequency: 'Monthly' },
  features: [
    { id: 'qqq_price', kind: 'price', asset: QQQ },
    { id: 'qqq_sma200', kind: 'sma', asset: QQQ, period: 200 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'lt', left: { ref: 'qqq_price' }, right: { ref: 'qqq_sma200' } },
    then: { op: 'allocate', weights: { 'us:UGL': 0.3334, 'us:KMLM': 0.3333, 'us:ZROZ': 0.3333 } },
    else: { op: 'allocate', weights: { 'us:TQQQ': 0.6, 'us:UGL': 0.15, 'us:KMLM': 0.15, 'us:ZROZ': 0.1 } },
  },
};

// --- 2. Wire shared runtime layers ----------------------------------------

const calendar = new NYSEExchangeCalendar();

// Backtest ends a few sessions before "now" so the executor's nextOpen lookup
// always finds a fill bar — mutual funds (LCSIX) and some ETFs lag a day or
// two on yfinance, especially right after market open. The last snapshot is
// still effectively the current decision since daily strategies don't
// rebalance intraday.
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const rangeEnd = new Date(today.getTime() - 5 * 86_400_000);
const range: DateRange = { from: new Date(rangeEnd.getTime() - 90 * 86_400_000), to: rangeEnd };
const runtimeRange: DateRange = {
  from: new Date(today.getTime() - 3 * 365 * 86_400_000),
  to: new Date(today.getTime() + 86_400_000),
};

const dataFeed = new YfinanceDataFeed();

function makeExecutor(): BacktestExecutor {
  return new BacktestExecutor({
    calendar,
    nextOpen: async (asset: Asset, t: Date) => {
      // Reuse runtimeRange so YfinanceDataFeed's per-instance cache hits.
      for await (const bar of dataFeed.bars(asset, runtimeRange, '1d')) {
        if (bar.t.getTime() > t.getTime()) return { t: bar.t, price: bar.open };
      }
      throw new Error(`featured-strategies-now: no next-open for ${asset.symbol} after ${t.toISOString()}`);
    },
  });
}

// --- 3. Run each strategy and report current decision ---------------------

async function runOne(name: string, spec: TacticalSpec): Promise<void> {
  const featureCache = new MemoryFeatureCache();
  const runtime = new FeatureRuntime({ dataFeed, featureCache, range: runtimeRange, freq: '1d' });
  const strategy = fromSpec(spec, { runtime, calendar });

  const result = await runBacktest({
    strategy,
    range,
    initialPortfolio: { cash: 100_000, positions: [], t: range.from },
    dataFeed,
    executor: makeExecutor(),
    calendar,
  });

  const final = result.snapshots.at(-1);
  if (!final) {
    console.log(`--- ${name} ---`);
    console.log(`  no sessions in range — yfinance may be lagging or range is empty`);
    console.log('');
    return;
  }

  // Latest snapshot date and per-asset latest bar prices.
  const latestT = final.t.toISOString().slice(0, 10);
  const positions = final.portfolio.positions
    .filter((p) => p.quantity !== 0)
    .map((p) => `${p.asset.symbol}×${p.quantity.toFixed(0)}`)
    .join(' ');
  const heldIds: AssetId[] = final.portfolio.positions.filter((p) => p.quantity !== 0).map((p) => p.asset.id);

  // Approximate target weights as held basis fraction.
  const totalBasis = final.portfolio.positions.reduce((s, p) => s + p.basis, 0);
  const weightLines = final.portfolio.positions
    .filter((p) => p.quantity !== 0)
    .map((p) => `    ${p.asset.symbol.padEnd(6)} ${((p.basis / totalBasis) * 100 || 0).toFixed(1)}%`);

  console.log(`--- ${name} ---`);
  console.log(`  last session : ${latestT}`);
  console.log(`  positions    : ${positions || '(none)'}`);
  console.log(`  current weights:`);
  for (const line of weightLines) console.log(line);
  console.log(`  branch (held assets) : ${heldIds.join(', ')}`);
  console.log('');
}

console.log('=== featured-strategies live-now snapshot ===');
console.log(`backtest range : ${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)}`);
console.log(
  `(strategy decisions are based on the last completed session — daily strategies don't rebalance intraday)\n`,
);

await runOne('Golden Butterfly Tactical', goldenButterflyTactical);
await runOne('Trend Rocket', trendRocket);
await runOne('Crisis Ready Turbo', crisisReadyTurbo);
await runOne('Leveraged Moving Average', leveragedMovingAverage);
