# Composing streaming data feeds

The [Composing data feeds](/recipes/composing-data-feeds) recipe showed how to wire an equity vendor and a macro vendor behind `RoutingDataFeed` for backtesting. The same strategy, handed to `runLive`, needs a `StreamingDataFeed` — a sibling interface, not a union. `RoutingDataFeed` won't satisfy it.

The macro slot is the awkward one. FRED publishes daily and weekly series via REST with revisions; there is no WebSocket. Equity (Polygon, Alpaca, Yahoo WS) is push-native. `pollingStreamFromHistorical` bridges the gap: it wraps any `DataFeed` as a `StreamingDataFeed` by polling on a configurable schedule, with per-asset `lastSeenT` deduplication so re-publishes and backwards revisions never violate the strict-ascending-t invariant downstream.

This recipe wires `RoutingStreamingDataFeed({ equity: push, macro: poll })` behind a single `StreamingDataFeed` accepted by `runLive`. The strategy is identical to the historical recipe — same SPY/TLT yield-gate — so the two pages can be read as a pair.

## The strategy

```
if dgs10_yield > 4.5  →  100% TLT  (defensive: long bonds when rates are high)
else                  →  100% SPY  (risk-on: long stocks otherwise)
```

Rebalance monthly. Universe: SPY, TLT (equity) and DGS10 (macro). Spec and fixtures are identical to the historical recipe; see [Composing data feeds](/recipes/composing-data-feeds) for the full walkthrough.

## Wiring the live feed

```ts
import {
  RoutingStreamingDataFeed,
  pollingStreamFromHistorical,
} from '@livefolio/sdk';

// Equity: push-native (Polygon WS, Yahoo WS, Alpaca, etc.)
declare const equityStream: StreamingDataFeed;

// Macro: polling adapter wrapping the same FRED DataFeed used in backtest.
// Session-close schedule polls once per NYSE session close, matching the
// cadence at which tactical/v1 evaluates the yield-gate rule.
const nyse = new NYSEExchangeCalendar();
const macroPoll = pollingStreamFromHistorical({
  feed: fredHistorical,            // same DataFeed as the backtest
  freq: '1d',
  schedule: { kind: 'session-close', calendar: nyse },
  initialFrom: range.to,           // resume from backtest end; skip already-seen bars
});

// Compose: one StreamingDataFeed accepted by runLive.
const liveFeed = new RoutingStreamingDataFeed({
  equity: equityStream,
  macro:  macroPoll,
});
```

For lower-latency macro polling, use an interval schedule instead:

```ts
const macroPoll = pollingStreamFromHistorical({
  feed: fredHistorical,
  freq: '1d',
  schedule: { kind: 'interval', intervalMs: 60 * 60 * 1000 }, // every hour
  initialFrom: range.to,
});
```

## Why the macro slot is polled, not subscribed

Equity ticks are push-native: Polygon, Alpaca, and Yahoo WS maintain open connections and push new bars as they close. FRED publishes macro series (DGS10, UNRATE, PCE, etc.) via a REST API with daily or weekly cadence and frequent historical revisions. There is no streaming endpoint.

`pollingStreamFromHistorical` wraps the historical FRED feed so it satisfies `StreamingDataFeed`'s contract without inventing fake ticks. Per-asset `lastSeenT` tracking deduplicates: if FRED revises a previously-published value at the same timestamp, the adapter drops the re-publish. A backwards revision (older timestamp) is also dropped — preserving the `StreamingDataFeed` contract that each asset's bars arrive in strictly ascending `t` order, which `FeatureRuntime.appendBar` requires.

## Production wiring

Install your vendor adapters alongside the SDK:

```bash
npm install @livefolio/yfinance @livefolio/fred
```

```ts
import {
  RoutingDataFeed,
  RoutingStreamingDataFeed,
  pollingStreamFromHistorical,
  NYSEExchangeCalendar,
} from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';
import { FredDataFeed } from '@livefolio/fred';

const nyse = new NYSEExchangeCalendar();
const fredHistorical = new FredDataFeed({ apiKey: process.env.FRED_API_KEY! });

// Historical feed (backtest):
const histFeed = new RoutingDataFeed({
  equity: new YfinanceDataFeed(),
  macro:  fredHistorical,
});

// Streaming feed (live):
const liveFeed = new RoutingStreamingDataFeed({
  equity: new YfinanceStreamingDataFeed(),    // hypothetical streaming vendor
  macro:  pollingStreamFromHistorical({
    feed: fredHistorical,                      // same instance — one adapter, two roles
    freq: '1d',
    schedule: { kind: 'session-close', calendar: nyse },
    initialFrom: range.to,
  }),
});

const result = await runBacktest({ /* …, dataFeed: histFeed */ });
for await (const ev of runLive({ /* …, dataFeed: liveFeed */ })) { /* … */ }
```

One historical adapter, two roles: `YfinanceDataFeed` feeds the backtest and the same `FredDataFeed` instance is wrapped by the polling adapter for live. No duplicated vendor code in user-land.

## Full code

The runnable script lives at `scripts/docs/recipes/composing-streaming-data-feeds.ts`. Run it with:

```bash
npx tsx scripts/docs/recipes/composing-streaming-data-feeds.ts
```

Synthetic in-memory feeds make the script offline-runnable. The equity streaming feed yields a bounded set of ticks and terminates; the macro polling adapter uses injected `now`/`sleep` to advance simulated time without real delays. The `for await` loop breaks after 20 events for deterministic termination.

```ts
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
// ... (see full script at scripts/docs/recipes/composing-streaming-data-feeds.ts)

// --- 6. Streaming live feeds -----------------------------------------------

// Equity: bounded synthetic ticks. The generator yields 5 ticks over 5
// consecutive trading days and then returns naturally.
const equityStream: StreamingDataFeed = {
  async *subscribe(_assets) {
    for (const tick of LIVE_EQUITY_TICKS) {
      yield tick;
    }
    // Generator returns naturally — signals completion to RoutingStreamingDataFeed.
  },
};

// Macro: pollingStreamFromHistorical wrapping the same macroFeed from the backtest.
// Injected now/sleep run in accelerated time — no real delays.
let mockNow = runtimeRange.to;
const macroPoll = pollingStreamFromHistorical({
  feed: macroFeed,
  freq: '1d',
  schedule: { kind: 'interval', intervalMs: 24 * 60 * 60 * 1000 },
  initialFrom: range.to,
  now: () => mockNow,
  sleep: async (ms) => { mockNow = new Date(mockNow.getTime() + ms); },
});

// --- 7. Compose via RoutingStreamingDataFeed --------------------------------

const liveFeed = new RoutingStreamingDataFeed({
  equity: equityStream,
  macro:  macroPoll,
});

// --- 8. Streaming runtime + live run ---------------------------------------

const streamingRuntime = new FeatureRuntime({
  mode: 'streaming',
  featureCache: new MemoryFeatureCache(),
  freq: '1d',
  initialBars: history.bars,  // seed from backtest bars
});

const liveStrategy = fromSpec(spec, { runtime: streamingRuntime, calendar });

for await (const ev of runLive({
  strategy: liveStrategy,
  history,
  dataFeed: liveFeed,
  executor,
  calendar,
  streamingRuntime,  // share with fromSpec strategy so appendBar reaches the right runtime
})) {
  if (ev.type === 'mark') { /* intra-session tick preview */ }
  else { /* ev.type === 'snapshot': session closed */ }
  if (++eventCount >= MAX_EVENTS) break;
}
```

## What you should see

```
=== composing-streaming-data-feeds recipe ===
backtest snapshots : 249
backtest bars (SPY): 644

--- live events ---
snapshot  t=2024-04-01  cash=$15.72  positions=[TLT×1246.0]  orders=0
mark      t=2024-08-05  SPY=$480.00  previewOrders=0
mark      t=2024-04-02  SPY=$480.00  previewOrders=0
mark      t=2024-08-05  SPY=$480.00  previewOrders=0
mark      t=2024-04-03  SPY=$480.00  previewOrders=0
snapshot  t=2024-08-05  cash=$15.72  positions=[TLT×1246.0]  orders=0
mark      t=2024-08-06  SPY=$482.00  previewOrders=0
mark      t=2024-04-04  SPY=$482.00  previewOrders=0
mark      t=2024-08-06  SPY=$482.00  previewOrders=0
mark      t=2024-04-05  SPY=$482.00  previewOrders=0
snapshot  t=2024-08-06  cash=$15.72  positions=[TLT×1246.0]  orders=0
...

total events : 20  (mark=16  snapshot=4)
```

`mark` events with August timestamps come from equity ticks; marks with April/May timestamps come from macro polling ticks yielded between equity ticks. Both asset kinds flow through the same `RoutingStreamingDataFeed`; `runLive` processes them uniformly. Session snapshots fire when a tick's session date crosses the boundary — only equity ticks advance the session boundary here because macro bar timestamps are behind the live equity window.

## Notes

- **Bounded equity stream.** The runnable script yields a fixed set of ticks and lets the generator return naturally. `RoutingStreamingDataFeed` drops a finished upstream and continues with the rest. The `for await` breaks at `MAX_EVENTS = 20` as an additional safety net because the macro polling adapter is open-ended.
- **Injected `now` and `sleep`.** Without injection, `pollingStreamFromHistorical` would call `setTimeout` and `new Date()` — making the docs script block for real wall-clock intervals. The injected closures advance a simulated clock instead, so the script runs in milliseconds.
- **`initialFrom: range.to`.** Setting `initialFrom` to the backtest end date tells the adapter to skip bars the backtest already processed. Without it, every poll on first call would re-emit the entire historical series — harmless (dedup handles re-emits) but wasteful.
- **`streamingRuntime` must be shared.** Passing the same `FeatureRuntime` instance to both `fromSpec` and `runLive` is required for `fromSpec` strategies. See [Replay-then-stream](/recipes/replay-then-stream) for the full explanation.
- **Design rationale.** For a deeper dive into why the sibling-interface split exists and the polling adapter's dedup semantics, see `docs/specs/2026-05-03-routing-streaming-and-polling-design.md`.

## See also

- [Composing data feeds](/recipes/composing-data-feeds) — the backtest counterpart of this recipe
- [Replay-then-stream](/recipes/replay-then-stream) — the single-vendor live-runtime baseline this extends
- [`RoutingStreamingDataFeed` API](/api/classes/RoutingStreamingDataFeed)
- [`pollingStreamFromHistorical` API](/api/functions/pollingStreamFromHistorical)
