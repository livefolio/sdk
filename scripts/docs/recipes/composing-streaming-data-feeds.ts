// Recipe: Composing streaming data feeds with RoutingStreamingDataFeed
//
// Live counterpart of the Composing-data-feeds recipe. Tactical strategies
// that compose equity + macro data via RoutingDataFeed for backtesting need the
// streaming sibling (RoutingStreamingDataFeed) for live runs — because
// runLive accepts StreamingDataFeed, not DataFeed.
//
// The macro slot is the awkward one: FRED publishes daily/weekly via REST with
// revisions; there is no native WebSocket. pollingStreamFromHistorical wraps
// the existing FRED DataFeed as a StreamingDataFeed via scheduled REST polls
// + per-asset lastSeenT dedup, so the macro slot satisfies the interface
// without inventing fake ticks.
//
// In production you'd use:
//   const equityStream  = new PolygonStreamingDataFeed({ apiKey: process.env.POLYGON_KEY! });
//   const macroPoll = pollingStreamFromHistorical({
//     feed: new FredDataFeed({ apiKey: process.env.FRED_API_KEY! }),
//     freq: '1d',
//     schedule: { kind: 'session-close', calendar: nyse },
//     initialFrom: range.to,
//   });
// This script substitutes bounded synthetic feeds so it runs offline.
//
//   npx tsx scripts/docs/recipes/composing-streaming-data-feeds.ts

import {
  fromSpec,
  runBacktest,
  runLive,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
  RoutingDataFeed,
  RoutingStreamingDataFeed,
  pollingStreamFromHistorical,
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

// --- 1. Assets (same as composing-data-feeds recipe) ----------------------

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const TLT = { id: 'us:TLT', symbol: 'TLT' };
// Macro asset — kind: 'macro' routes it to the macro inner feed.
const DGS10 = { kind: 'macro' as const, id: 'DGS10', symbol: '10Y Treasury' };

// --- 2. Strategy spec (same as composing-data-feeds recipe) ---------------
//
// Rule tree: a single if/else gate on the 10y yield.
//   dgs10_yield > 4.5  →  100% TLT  (defensive: long bonds when rates are high)
//   else               →  100% SPY  (risk-on: long stocks otherwise)

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, TLT, DGS10],
  rebalance: { frequency: 'Monthly' },
  features: [{ id: 'dgs10_yield', kind: 'price', asset: DGS10 }],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'dgs10_yield' }, right: 4.5 },
    then: { op: 'allocate', weights: { 'us:TLT': 1.0 } },
    else: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
  },
};

// --- 3. Synthetic fixtures (same data as composing-data-feeds recipe) ------

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeEquityBars(start: Date, days: number, basePrice: number, drift: number, phase: number): Bar[] {
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

const EQUITY_FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeEquityBars(utc('2022-01-03'), 900, 450, 0.0004, 0),
  'us:TLT': makeEquityBars(utc('2022-01-03'), 900, 95, -0.0001, 30),
};

function makeMacroBars(start: Date, days: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    const yieldValue = 4.4 + Math.sin(i / 60) * 0.6;
    bars.push({ t, open: yieldValue, high: yieldValue, low: yieldValue, close: yieldValue, volume: 0 });
  }
  return bars;
}

const MACRO_FIXTURES: Record<string, Bar[]> = {
  // 1200 days covers from 2022-01-03 well past 2025-06-01, giving the
  // polling adapter fresh bars to yield after runtimeRange.to (2024-08-01).
  DGS10: makeMacroBars(utc('2022-01-03'), 1200),
};

// --- 4. Historical feeds (used for backtest + macro polling) ---------------

const equityFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = EQUITY_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-streaming-data-feeds: no equity fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

const macroFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = MACRO_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-streaming-data-feeds: no macro fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// --- 5. Backtest (historical leg) ------------------------------------------

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-04-01') };
const runtimeRange: DateRange = { from: utc('2022-01-03'), to: utc('2024-08-01') };

const historicalFeed = new RoutingDataFeed({ equity: equityFeed, macro: macroFeed });

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
    const bars = EQUITY_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-streaming-data-feeds: no fill fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`composing-streaming-data-feeds: no bar after ${t.toISOString()} for ${asset.id}`);
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
  featureRuntime: historicalRuntime, // populate result.bars for streaming runtime seeding
});

// --- 6. Streaming live feeds -----------------------------------------------
//
// Equity: bounded synthetic ticks. The generator yields 5 ticks over 5
// consecutive trading days after the backtest range and then returns naturally.
// When this upstream finishes, RoutingStreamingDataFeed drops it and the
// consumer loop's for-await sees the router terminate (all upstreams done).
//
// Macro: pollingStreamFromHistorical wrapping the same macroFeed from the
// backtest. `now` is a mutable closure advanced by each sleep(ms) call —
// this makes the polling adapter run in accelerated time without any real
// delays. `sleep` is a no-op async function.
//
// The macro slot runs while(true) internally, but RoutingStreamingDataFeed
// will cancel it (call return()) when the equity upstream finishes and the
// router itself is cancelled by the for-await break below.

// 5 consecutive trading days starting after the runtimeRange ends (2024-08-01).
// Live ticks must be strictly after the last bar in history.bars so
// appendBar's ascending-t invariant is satisfied.
const liveStartDate = utc('2024-08-05'); // first weekday after runtimeRange.to
const MS_DAY = 86_400_000;
const LIVE_EQUITY_TICKS: StreamingBar[] = [];

// Build 5 equity ticks (skip weekends).
{
  let t = liveStartDate;
  let count = 0;
  while (count < 5) {
    if (t.getUTCDay() !== 0 && t.getUTCDay() !== 6) {
      const price = 480 + count * 2;
      LIVE_EQUITY_TICKS.push({
        asset: { kind: 'equity', id: 'us:SPY', symbol: 'SPY' },
        bar: { t, open: price, high: price * 1.005, low: price * 0.995, close: price, volume: 900_000 },
      });
      LIVE_EQUITY_TICKS.push({
        asset: { kind: 'equity', id: 'us:TLT', symbol: 'TLT' },
        bar: {
          t,
          open: 92 + count,
          high: (92 + count) * 1.003,
          low: (92 + count) * 0.997,
          close: 92 + count,
          volume: 300_000,
        },
      });
      count++;
    }
    t = new Date(t.getTime() + MS_DAY);
  }
}

// Bounded synthetic equity streaming feed.
const equityStream: StreamingDataFeed = {
  async *subscribe(_assets) {
    for (const tick of LIVE_EQUITY_TICKS) {
      yield tick;
    }
    // Generator returns naturally — signals completion to RoutingStreamingDataFeed.
  },
};

// Macro polling adapter: wraps the same macroFeed used in the backtest.
// Injected now/sleep let the polling advance in simulated time instantly.
// Start polling from range.to (2024-04-01) — the backtest end date.
// The macro polling adapter will pick up any DGS10 bars published after that date.
// mockNow starts at runtimeRange.to (2024-08-01) so that the first poll's
// `to = now()` covers April→August 2024 and finds new macro bars.
let mockNow = runtimeRange.to;
const macroPoll = pollingStreamFromHistorical({
  feed: macroFeed,
  freq: '1d',
  schedule: { kind: 'interval', intervalMs: 24 * 60 * 60 * 1000 }, // 1 day
  initialFrom: range.to, // resume from backtest end — don't re-emit backtest history
  now: () => mockNow,
  sleep: async (ms) => {
    // Advance simulated clock instead of actually waiting.
    mockNow = new Date(mockNow.getTime() + ms);
  },
});

// --- 7. Compose via RoutingStreamingDataFeed --------------------------------

const liveFeed = new RoutingStreamingDataFeed({
  equity: equityStream,
  macro: macroPoll,
});

// --- 8. Streaming runtime (seeded from history.bars) -----------------------

const streamingRuntime = new FeatureRuntime({
  mode: 'streaming',
  featureCache: new MemoryFeatureCache(),
  freq: '1d',
  initialBars: history.bars,
});

const liveStrategy = fromSpec(spec, { runtime: streamingRuntime, calendar });

// --- 9. Run live -----------------------------------------------------------
//
// We break after MAX_EVENTS to guarantee termination — the macro polling
// adapter is open-ended, so RoutingStreamingDataFeed won't terminate until
// we cancel it. In production the for-await loop runs indefinitely; here a
// bounded break keeps the docs script offline-safe.

const MAX_EVENTS = 20;
let eventCount = 0;
let markCount = 0;
let snapshotCount = 0;

console.log('=== composing-streaming-data-feeds recipe ===');
console.log(`backtest snapshots : ${history.snapshots.length}`);
console.log(`backtest bars (SPY): ${history.bars.get('us:SPY')?.length ?? 0}`);
console.log('');
console.log('--- live events ---');

for await (const ev of runLive({
  strategy: liveStrategy,
  history,
  dataFeed: liveFeed,
  executor,
  calendar,
  streamingRuntime,
})) {
  eventCount++;
  if (ev.type === 'mark') {
    markCount++;
    const spyPrice = ev.prices.get('us:SPY');
    console.log(
      `mark      t=${ev.t.toISOString().slice(0, 10)}  SPY=$${spyPrice !== undefined ? spyPrice.toFixed(2) : 'n/a'}  previewOrders=${ev.previewOrders.length}`,
    );
  } else {
    snapshotCount++;
    const cash = ev.portfolio.cash.toFixed(2);
    const positions = ev.portfolio.positions.map((p) => `${p.asset.symbol}×${p.quantity.toFixed(1)}`).join(' ');
    console.log(
      `snapshot  t=${ev.t.toISOString().slice(0, 10)}  cash=$${cash}  positions=[${positions}]  orders=${ev.orders.length}`,
    );
  }
  if (eventCount >= MAX_EVENTS) break;
}

console.log('');
console.log(`total events : ${eventCount}  (mark=${markCount}  snapshot=${snapshotCount})`);
