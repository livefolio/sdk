// Recipe: Featured strategies — porting Livefolio's flagship strategies to v0.4
//
// Backtests four hand-curated tactical strategies originally authored on the
// v0.3 fluent API and ported to plain-data `TacticalSpec`s here:
//
//   1. Golden Butterfly Tactical   — RSI / SMA-trend rotation across 5 sleeves
//   2. Trend Rocket                — leveraged trend-following with bond fallback
//   3. Crisis Ready Turbo          — static three-sleeve crisis hedge
//   4. Leveraged Moving Average    — monthly QQQ trend gate, TQQQ-heavy
//
// In production the data layer is `@livefolio/yfinance`:
//
//   import { YfinanceDataFeed } from '@livefolio/yfinance';
//   const dataFeed = new YfinanceDataFeed();
//
// This script substitutes synthetic in-memory bars so it runs offline, has no
// network dependency, and satisfies docs:check without pulling adapter
// packages into the SDK's devDependencies. For a live-yfinance harness see
// `parity/src/featured-strategies-now.ts` and `parity/src/featured-strategies-listen.ts`.
//
//   npx tsx scripts/docs/recipes/featured-strategies.ts
//
// Companion docs: docs-site/recipes/featured-strategies.md

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type {
  TacticalSpec,
  Asset,
  Bar,
  DataFeed,
  DateRange,
  Frequency,
  Portfolio,
  Strategy,
  Features,
} from '@livefolio/sdk';

// --- 1. Asset universe ----------------------------------------------------

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

// --- 2. Strategy specs ----------------------------------------------------

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
  rules: {
    op: 'allocate',
    weights: { 'us:UGL': 0.33, 'us:KMLM': 0.33, 'us:UPRO': 0.34 },
  },
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
    else: {
      op: 'allocate',
      weights: { 'us:TQQQ': 0.6, 'us:UGL': 0.15, 'us:KMLM': 0.15, 'us:ZROZ': 0.1 },
    },
  },
};

// --- 3. Synthetic in-memory DataFeed --------------------------------------

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const MS_DAY = 86_400_000;

function makeBars(start: Date, days: number, basePrice: number, drift: number, phase = 0): Bar[] {
  const bars: Bar[] = [];
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price = price * (1 + drift + Math.sin((i + phase) / 14) * 0.006);
    bars.push({ t, open: price, high: price * 1.005, low: price * 0.995, close: price, volume: 1_000_000 });
  }
  return bars;
}

const start = utc('2022-01-03');
const FIXTURES: Record<string, Bar[]> = {
  'us:TQQQ': makeBars(start, 900, 60, 0.0009, 0),
  'us:SQQQ': makeBars(start, 900, 12, -0.0006, 30),
  'us:QQQ': makeBars(start, 900, 360, 0.0006, 5),
  'us:SPY': makeBars(start, 900, 450, 0.0004, 10),
  'us:UPRO': makeBars(start, 900, 50, 0.0011, 12),
  'us:UGL': makeBars(start, 900, 70, 0.0003, 40),
  'us:GLD': makeBars(start, 900, 180, 0.00015, 38),
  'us:IAU': makeBars(start, 900, 36, 0.00015, 42),
  'us:AGG': makeBars(start, 900, 95, -0.00005, 60),
  'us:KMLM': makeBars(start, 900, 30, 0.0002, 80),
  'us:ZROZ': makeBars(start, 900, 75, -0.0001, 65),
  'us:UUP': makeBars(start, 900, 28, 0.00005, 90),
  'us:USMV': makeBars(start, 900, 80, 0.0003, 18),
  'us:VTIP': makeBars(start, 900, 49, 0.00002, 70),
  'us:LCSIX': makeBars(start, 900, 22, 0.00025, 100),
};

const dataFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`featured-strategies: no fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// --- 4. Wire shared runtime layers ----------------------------------------

const calendar = new NYSEExchangeCalendar();
const runtimeRange: DateRange = { from: start, to: utc('2024-08-01') };
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-04-01') };

function makeExecutor(): BacktestExecutor {
  return new BacktestExecutor({
    calendar,
    nextOpen: async (asset: Asset, t: Date) => {
      const bars = FIXTURES[asset.id];
      if (!bars) throw new Error(`featured-strategies: no fill fixture for ${asset.id}`);
      const next = bars.find((b) => b.t.getTime() > t.getTime());
      if (!next) throw new Error(`featured-strategies: no bar after ${t.toISOString()} for ${asset.id}`);
      return { t: next.t, price: next.open };
    },
  });
}

// --- 5. Backtest each strategy --------------------------------------------

async function runOne(name: string, spec: TacticalSpec): Promise<void> {
  const featureCache = new MemoryFeatureCache();
  const runtime = new FeatureRuntime({ dataFeed, featureCache, range: runtimeRange, freq: '1d' });
  const strategy: Strategy<Features, unknown> = fromSpec(spec, { runtime, calendar });
  const initialPortfolio: Portfolio = { cash: 100_000, positions: [], t: range.from };

  const result = await runBacktest({
    strategy,
    range,
    initialPortfolio,
    dataFeed,
    executor: makeExecutor(),
    calendar,
  });

  const sessions = result.snapshots.length;
  const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
  const final = result.snapshots.at(-1);
  const investedBasis = (final?.portfolio.positions ?? []).reduce((sum, p) => sum + p.basis, 0);
  const cashPlusBasis = (final?.portfolio.cash ?? 0) + investedBasis;
  const positions = (final?.portfolio.positions ?? [])
    .map((p) => `${p.asset.symbol}×${p.quantity.toFixed(0)}`)
    .join(' ');

  console.log(`--- ${name} ---`);
  console.log(`  sessions      : ${sessions}`);
  console.log(`  rebalances    : ${rebalances}`);
  console.log(`  final cash    : $${(final?.portfolio.cash ?? 0).toFixed(2)}`);
  console.log(`  cash + basis  : $${cashPlusBasis.toFixed(2)}`);
  console.log(`  positions     : ${positions || '(none)'}`);
  console.log('');
}

console.log('=== featured-strategies recipe (synthetic data) ===\n');
await runOne('Golden Butterfly Tactical', goldenButterflyTactical);
await runOne('Trend Rocket', trendRocket);
await runOne('Crisis Ready Turbo', crisisReadyTurbo);
await runOne('Leveraged Moving Average', leveragedMovingAverage);
