// Recipe: Featured strategies — live run via polling adapter
//
// Continues the Trend Rocket strategy from a backtest seed into a streaming
// session. Trend Rocket is the cleanest live demo of the four featured
// strategies — daily cadence, single SMA crossover, disjoint sleeves so the
// branch decision is obvious from the orders.
//
// In production both legs run on `@livefolio/yfinance`:
//
//   import { YfinanceDataFeed } from '@livefolio/yfinance';
//   const dataFeed = new YfinanceDataFeed();
//   const liveFeed = pollingStreamFromHistorical({
//     feed: dataFeed,
//     freq: '1d',
//     schedule: { kind: 'session-close', calendar },
//     initialFrom: range.to,
//   });
//
// For a tick-driven WebSocket version (`@livefolio/yfinance-browser`'s
// `YfinanceStreamingDataFeed` running through Node), see
// `parity/src/featured-strategies-listen.ts`.
//
// This script substitutes synthetic in-memory bars + a bounded synthetic
// streaming feed so it runs offline, has no network dependency, and
// satisfies docs:check without pulling adapter packages into the SDK's
// devDependencies.
//
//   npx tsx scripts/docs/recipes/featured-strategies-live.ts
//
// Companion docs: docs-site/recipes/featured-strategies.md

import {
  fromSpec,
  runBacktest,
  runLive,
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
  StreamingDataFeed,
  StreamingBar,
} from '@livefolio/sdk';

// --- 1. Trend Rocket spec (same as featured-strategies.ts) ----------------

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const TQQQ = { id: 'us:TQQQ', symbol: 'TQQQ' };
const UPRO = { id: 'us:UPRO', symbol: 'UPRO' };
const UGL = { id: 'us:UGL', symbol: 'UGL' };
const GLD = { id: 'us:GLD', symbol: 'GLD' };
const AGG = { id: 'us:AGG', symbol: 'AGG' };

const spec: TacticalSpec = {
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

// --- 2. Synthetic historical fixture --------------------------------------

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
  'us:SPY': makeBars(start, 1500, 450, 0.0004, 10),
  'us:TQQQ': makeBars(start, 1500, 60, 0.0009, 0),
  'us:UPRO': makeBars(start, 1500, 50, 0.0011, 12),
  'us:UGL': makeBars(start, 1500, 70, 0.0003, 40),
  'us:GLD': makeBars(start, 1500, 180, 0.00015, 38),
  'us:AGG': makeBars(start, 1500, 95, -0.00005, 60),
};

const historicalFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`featured-strategies-live: no fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// --- 3. Run the historical leg --------------------------------------------

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-04-01') };
const runtimeRange: DateRange = { from: start, to: utc('2024-08-01') };

const historicalRuntime = new FeatureRuntime({
  dataFeed: historicalFeed,
  featureCache,
  range: runtimeRange,
  freq: '1d',
});
const historicalStrategy = fromSpec(spec, { runtime: historicalRuntime, calendar });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset: Asset, t: Date) => {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`featured-strategies-live: no fill fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`featured-strategies-live: no bar after ${t.toISOString()} for ${asset.id}`);
    return { t: next.t, price: next.open };
  },
});

const history = await runBacktest({
  strategy: historicalStrategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed: historicalFeed,
  executor,
  calendar,
  featureCache,
  featureRuntime: historicalRuntime,
});

// --- 4. Bounded synthetic streaming feed ---------------------------------

const LIVE_TICKS: StreamingBar[] = [];
{
  let t = utc('2024-08-05'); // first weekday after runtimeRange.to
  let count = 0;
  while (count < 5) {
    if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) {
      for (const id of Object.keys(FIXTURES)) {
        const last = FIXTURES[id]!.at(-1)!;
        const drift = 1 + (count + 1) * 0.005;
        const close = last.close * drift;
        LIVE_TICKS.push({
          asset: { kind: 'equity', id, symbol: id.replace(/^us:/, '') },
          bar: { t, open: close, high: close * 1.003, low: close * 0.997, close, volume: 800_000 },
        });
      }
      count++;
    }
    t = new Date(t.getTime() + MS_DAY);
  }
}

const liveFeed: StreamingDataFeed = {
  async *subscribe(_assets) {
    for (const tick of LIVE_TICKS) yield tick;
  },
};

// --- 5. Streaming runtime + run live --------------------------------------

const seedBars = new Map<string, Bar[]>();
for (const [assetId, bars] of history.bars) seedBars.set(assetId, [...bars]);

const streamingRuntime = new FeatureRuntime({
  mode: 'streaming',
  featureCache: new MemoryFeatureCache(),
  freq: '1d',
  initialBars: seedBars,
});
const liveStrategy = fromSpec(spec, { runtime: streamingRuntime, calendar });

console.log('=== featured-strategies-live recipe (synthetic data) ===');
console.log(`backtest range     : ${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)}`);
console.log(`backtest sessions  : ${history.snapshots.length}`);
console.log(`backtest rebalances: ${history.snapshots.filter((s) => s.orders.length > 0).length}`);
console.log('');
console.log('--- live events ---');

let markCount = 0;
let snapshotCount = 0;
for await (const ev of runLive({
  strategy: liveStrategy,
  history,
  dataFeed: liveFeed,
  executor,
  calendar,
  streamingRuntime,
})) {
  if (ev.type === 'mark') {
    markCount++;
    const spyPrice = ev.prices.get('us:SPY');
    console.log(
      `mark      t=${ev.t.toISOString().slice(0, 10)}  SPY=$${spyPrice !== undefined ? spyPrice.toFixed(2) : 'n/a'}  previewOrders=${ev.previewOrders.length}`,
    );
  } else if (ev.type === 'snapshot') {
    snapshotCount++;
    const positions = ev.portfolio.positions.map((p) => `${p.asset.symbol}×${p.quantity.toFixed(0)}`).join(' ');
    console.log(
      `snapshot  t=${ev.t.toISOString().slice(0, 10)}  cash=$${ev.portfolio.cash.toFixed(2)}  positions=[${positions}]  orders=${ev.orders.length}`,
    );
  }
}

console.log('');
console.log(`live events: mark=${markCount}  snapshot=${snapshotCount}`);
