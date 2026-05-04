# Replay-then-stream: continuous chart from history to live

Run a historical backtest to build the equity curve, then continue updating the
same chart from live ticks — no code branching, no data duplication. The
`runLive` event stream is shape-compatible with `BacktestSnapshot`, so the chart
never has to distinguish "old" from "new" data.

## End-to-end example

```ts
import {
  fromSpec, runBacktest, runLive,
  FeatureRuntime, MemoryFeatureCache, BacktestExecutor,
  NYSEExchangeCalendar,
} from '@livefolio/sdk';
import type {
  TacticalSpec, DataFeed, StreamingDataFeed, DateRange,
  Executor, BacktestResult,
} from '@livefolio/sdk';

declare const spec: TacticalSpec;
declare const historicalFeed: DataFeed;
declare const streamingFeed: StreamingDataFeed;
declare const liveExecutor: Executor;

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = {
  from: new Date('2023-01-01T00:00:00Z'),
  to:   new Date('2024-01-01T00:00:00Z'),
};

// ── 1. Build the historical FeatureRuntime ─────────────────────────────────
const historicalRuntime = new FeatureRuntime({
  dataFeed: historicalFeed,
  featureCache,
  range,
  freq: '1d',
});

const historicalStrategy = fromSpec(spec, { runtime: historicalRuntime, calendar });

const history: BacktestResult = await runBacktest({
  strategy: historicalStrategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed: historicalFeed,
  executor: new BacktestExecutor({ calendar, nextOpen: async (asset, t) => {
    // Return the next open price for the asset after time t.
    // In tests, look this up from a fixture map; in production, call your broker.
    throw new Error('provide nextOpen implementation');
  }}),
  calendar,
  featureCache,
  freq: '1d',
  featureRuntime: historicalRuntime,   // export bars into BacktestResult.bars
});

// ── 2. Render history to the chart ────────────────────────────────────────
for (const snap of history.snapshots) {
  chart.appendBar(snap);
}

// ── 3. Construct the streaming FeatureRuntime ────────────────────────────
// This runtime is seeded from history.bars so warmup indicators (SMA(200),
// etc.) work on the very first live tick — no cold-start gap.
const streamingRuntime = new FeatureRuntime({
  mode: 'streaming',
  featureCache: new MemoryFeatureCache(),
  freq: '1d',
  initialBars: history.bars,
});

// Re-construct the strategy using the streaming runtime. State is still
// continuous via history.finalState — only the feature backend changes.
const liveStrategy = fromSpec(spec, { runtime: streamingRuntime, calendar });

// ── 4. Drive the live stream ──────────────────────────────────────────────
for await (const ev of runLive({
  strategy: liveStrategy,
  history,
  dataFeed: streamingFeed,
  executor: liveExecutor,
  calendar,
  streamingRuntime,       // IMPORTANT: share the same instance (see below)
})) {
  if (ev.type === 'mark') {
    // Intra-session tick: update the wiggling rightmost bar.
    chart.updateLastBar({
      t:             ev.t,
      prices:        ev.prices,
      previewOrders: ev.previewOrders,
    });
  } else {
    // ev.type === 'snapshot': session closed and orders settled.
    chart.appendBar(ev);   // same shape as BacktestSnapshot
  }
}
```

## Why the same Strategy instance works across both runs

`Strategy<F, S>` threads state explicitly. `runBacktest` returns `finalState` on
the `BacktestResult`; `runLive` reads `history.finalState` and continues from
there. There are no captured mutable variables inside a `fromSpec` strategy —
Task 3 of the v0.4 redesign removed them — so a strategy constructed once in
`fromSpec` is safe to reuse across calls.

For the replay-then-stream workflow, however, you intentionally build **two
strategy instances**: one backed by the historical `FeatureRuntime` (for
`runBacktest`) and one backed by the streaming `FeatureRuntime` (for `runLive`).
The state bridge is `history.finalState` — `runLive` picks it up automatically
from `history`. The only thing that changes between the two instances is which
runtime backs the `features()` method.

## Sharing the streaming FeatureRuntime with fromSpec — the critical wiring

`fromSpec` closes over the `FeatureRuntime` it receives at construction time. The
strategy's `features()` method calls `runtime.compute(...)` on **that captured
instance**. If you let `runLive` build its own internal runtime (which happens
when you omit `streamingRuntime`), you end up with two separate runtimes:

- `runLive`'s internal runtime receives `appendBar` calls as live bars arrive.
- The strategy's captured runtime never receives those calls and returns stale
  indicator values.

The fix is to construct **one** streaming `FeatureRuntime`, pass it to
`fromSpec`, and also pass it to `runLive` via the `streamingRuntime` option:

```ts
// ONE shared instance — strategy and runLive both read/write this buffer.
const streamingRuntime = new FeatureRuntime({
  mode: 'streaming',
  featureCache: new MemoryFeatureCache(),
  freq: '1d',
  initialBars: history.bars,
});

const liveStrategy = fromSpec(spec, { runtime: streamingRuntime, calendar });

for await (const ev of runLive({
  strategy: liveStrategy,
  history,
  dataFeed: streamingFeed,
  executor: liveExecutor,
  calendar,
  streamingRuntime,   // runLive calls appendBar on this; strategy reads from it
})) { ... }
```

When `streamingRuntime` is omitted, `runLive` constructs its own internal
instance. This works correctly for hand-rolled strategies whose `features()`
method accepts the runtime as a parameter, but it silently produces stale
features for any strategy built via `fromSpec`.

## Mark events: "what would happen if the session closed now"

`runLive` yields a `mark` event on every incoming tick. The mark is computed in
**preview mode**: `state` is deep-cloned before calling `strategy.build`, the
clone is passed to `build`, and the returned state is discarded. Committed state
is never touched during a mark. This means 1 000 ticks within a single session
produce 1 000 marks but leave `state` exactly where the prior session-close
commit left it.

`ev.previewOrders` tells the UI what the strategy *would* emit if the session
ended at the current tick price. A typical use: "if the market closed right now,
this strategy would rebalance to 60 % SPY / 40 % IEF."

`ev.previewPortfolio` is currently a placeholder — it returns the unchanged
`ev.portfolio` (the portfolio at the *start* of the current session, before any
live fills). A future `simulateFills(orders, prices)` helper will compute the
hypothetical post-rebalance NAV by applying `previewOrders` at `ev.prices`.
Until that helper ships, compute estimated NAV yourself:

```ts
if (ev.type === 'mark') {
  // Approximate current NAV from open session portfolio + live prices.
  const nav = ev.portfolio.cash
    + ev.portfolio.positions.reduce((sum, pos) => {
        const price = ev.prices.get(pos.asset.id) ?? 0;
        return sum + pos.quantity * price;
      }, 0);
  chart.updateNAV(nav);
}
```

## Calendar-driven session boundaries

`runLive` uses `calendar.next(tick.t)` to detect when a tick crosses a session
boundary. This correctly handles after-hours activity: a NYSE tick at Friday
17:00 ET belongs to Friday's session; the boundary fires on the Monday 09:30 ET
open tick, not at midnight.

For crypto strategies that trade around the clock use `Crypto24x7Calendar`:

```ts
import { Crypto24x7Calendar } from '@livefolio/sdk';

const calendar = new Crypto24x7Calendar();
// Session boundaries fire at UTC midnight every calendar day.
```

## See also

- [Composing streaming data feeds](/recipes/composing-streaming-data-feeds) — extend the live runtime to multi-vendor (equity push + macro polling)
- Design spec: [docs/specs/2026-05-02-v0.4-phase-9-streaming-design.md](https://github.com/livefolio/sdk/blob/main/docs/specs/2026-05-02-v0.4-phase-9-streaming-design.md)
- [`runBacktest`](/api/functions/runBacktest)
- [`runLive`](/api/functions/runLive)
- [`LiveEvent`](/api/type-aliases/LiveEvent)
- [`StreamingDataFeed`](/api/interfaces/StreamingDataFeed)
- [`Crypto24x7Calendar`](/api/classes/Crypto24x7Calendar)
- [`FeatureRuntime`](/api/classes/FeatureRuntime)
