/**
 * Runnable example: replay-then-stream pipeline using @livefolio/alpaca for live execution.
 * Companion to docs-site/recipes/replay-then-stream.md.
 *
 * Requires ALPACA_PAPER_KEY_ID and ALPACA_PAPER_SECRET_KEY env vars to actually run live.
 * Without them, the script will throw inside AlpacaExecutor's constructor — which is correct
 * behavior; the sample is here to compile-check the wiring shape, not to run unattended.
 */

// Using AlpacaDataFeed for the backtest leg keeps all three adapters in a single import
// block and shows the full @livefolio/alpaca surface. In production you might prefer
// @livefolio/yfinance for the historical leg if wider symbol coverage is needed.
import {
  fromSpec,
  runBacktest,
  runLive,
  FeatureRuntime,
  MemoryFeatureCache,
  BacktestExecutor,
  NYSEExchangeCalendar,
} from '@livefolio/sdk';
import type { TacticalSpec, DateRange, Asset } from '@livefolio/sdk';
import { AlpacaDataFeed, AlpacaExecutor, AlpacaStreamingDataFeed } from '@livefolio/alpaca';

// ── 1. Credentials (paper account) ───────────────────────────────────────────

const KEY_ID = process.env['ALPACA_PAPER_KEY_ID'] ?? '';
const SECRET_KEY = process.env['ALPACA_PAPER_SECRET_KEY'] ?? '';

// ── 2. Strategy spec ─────────────────────────────────────────────────────────
//
// Simple SPY trend-following strategy: hold SPY when its 5-day SMA is above
// its 20-day SMA; hold cash otherwise. Compact enough to illustrate the wiring
// without obscuring the pipeline.

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };
const IEF: Asset = { kind: 'equity', id: 'us:IEF', symbol: 'IEF' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, IEF],
  rebalance: { frequency: 'Daily' },
  features: [
    { id: 'spy_sma5', kind: 'sma', asset: SPY, period: 5, delay: 1 },
    { id: 'spy_sma20', kind: 'sma', asset: SPY, period: 20, delay: 1 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_sma5' }, right: { ref: 'spy_sma20' } },
    then: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};

// ── 3. Runtime layers ─────────────────────────────────────────────────────────

const calendar = new NYSEExchangeCalendar();

// AlpacaDataFeed: fetches historical bars from Alpaca's /v2/stocks/{symbol}/bars
// endpoint with in-memory caching and total-return adjustment.
// (No `paper` flag — AlpacaDataFeed targets the same market-data API regardless of account type.)
const historicalFeed = new AlpacaDataFeed({ keyId: KEY_ID, secretKey: SECRET_KEY });

// AlpacaStreamingDataFeed: connects to Alpaca's WebSocket trades stream.
// Each trade becomes a StreamingBar (degenerate bar at trade price).
const streamingFeed = new AlpacaStreamingDataFeed({ keyId: KEY_ID, secretKey: SECRET_KEY });

// AlpacaExecutor: routes SDK Orders to Alpaca paper orders via /v2/orders,
// polling for terminal status before returning fills.
const executor = new AlpacaExecutor({ keyId: KEY_ID, secretKey: SECRET_KEY, paper: true });

// ── 4. Historical backtest ────────────────────────────────────────────────────
//
// 30-day window ending today. AlpacaDataFeed fetches the bars from Alpaca's
// REST API; FeatureRuntime computes SMA features and exports bars into result.bars
// so the streaming runtime can warm up without a cold-start gap.

async function main() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const range: DateRange = { from, to };

  const featureCache = new MemoryFeatureCache();
  const historicalRuntime = new FeatureRuntime({
    dataFeed: historicalFeed,
    featureCache,
    range,
    freq: '1d',
  });

  const historicalStrategy = fromSpec(spec, { runtime: historicalRuntime, calendar });

  const history = await runBacktest({
    strategy: historicalStrategy,
    range,
    initialPortfolio: { cash: 100_000, positions: [], t: range.from },
    dataFeed: historicalFeed,
    executor: new BacktestExecutor({
      calendar,
      nextOpen: async (_asset, t) => {
        // In production: call your broker or data feed for the next open price.
        // Here we use a placeholder that keeps the compile check passing.
        return { t, price: 0 };
      },
    }),
    calendar,
    featureCache,
    featureRuntime: historicalRuntime, // exports bars → result.bars for streaming warmup
  });

  console.log(`backtest: ${history.snapshots.length} sessions`);
  for (const snap of history.snapshots) {
    console.log(`  ${snap.t.toISOString().slice(0, 10)}  cash=${snap.portfolio.cash.toFixed(0)}`);
  }

  // ── 5. Streaming FeatureRuntime seeded from historical bars ─────────────────
  //
  // SMA(20) needs 20 bars of history to produce a value on tick 1. Seeding
  // from history.bars means the first live tick immediately has valid features —
  // no cold-start gap.

  const streamingRuntime = new FeatureRuntime({
    mode: 'streaming',
    featureCache: new MemoryFeatureCache(),
    freq: '1d',
    initialBars: history.bars,
  });

  const liveStrategy = fromSpec(spec, { runtime: streamingRuntime, calendar });

  // ── 6. Live stream ────────────────────────────────────────────────────────────
  //
  // runLive: single options object — strategy, history, dataFeed (StreamingDataFeed),
  // executor, calendar, streamingRuntime. NOT positional args.

  let eventCount = 0;
  for await (const event of runLive({
    strategy: liveStrategy,
    history,
    dataFeed: streamingFeed, // AlpacaStreamingDataFeed
    executor, // AlpacaExecutor
    calendar,
    streamingRuntime, // share with fromSpec so appendBar lands on the right buffer
  })) {
    eventCount++;
    if (event.type === 'mark') {
      // Intra-session tick: update the wiggling rightmost bar.
      const nav =
        event.portfolio.cash +
        event.portfolio.positions.reduce((sum, pos) => {
          const price = event.prices.get(pos.asset.id) ?? 0;
          return sum + pos.quantity * price;
        }, 0);
      console.log(`mark  t=${event.t.toISOString()}  approxNAV=${nav.toFixed(0)}`);
    } else {
      // ev.type === 'snapshot': session closed and orders settled.
      console.log(`snap  t=${event.t.toISOString()}  orders=${event.orders.length}`);
    }
    if (eventCount >= 10) break; // stop after a handful of events for demo purposes
  }
}

main().catch(console.error);
