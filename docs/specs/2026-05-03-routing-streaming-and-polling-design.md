# Routing for streaming + polling adapter

**Status:** Design
**Date:** 2026-05-03
**Scope:** v0.4 SDK reference implementation
**Companion specs:**
- `docs/specs/2026-05-02-v0.4-phase-9-streaming-design.md` — establishes the sibling-interface split (`DataFeed` ↔ `StreamingDataFeed`) this spec builds on.
- `docs/specs/2026-05-03-v0.4-routing-data-feed-design.md` — historical counterpart of the routing class shipped here.

## Motivation

Tactical strategies routinely compose vendors — Yahoo equities + FRED macro is the canonical mix today, and `RoutingDataFeed` already lets `runBacktest` consume both behind one `DataFeed`. The same strategy, when handed to `runLive`, needs a `StreamingDataFeed` (`src/strategy/run-live.ts:72`). That interface is a sibling, not a union, so `RoutingDataFeed` can't be reused — it implements the wrong shape.

Concretely, two gaps prevent multi-vendor live runs:

1. **No streaming router.** Users who composed equity + macro for backtest can't compose them for live without hand-rolling a k-way async-iterable merge.
2. **Macro vendors don't stream.** FRED publishes daily/weekly/monthly via REST with revisions; there's no WebSocket. Equity (Polygon, Alpaca, Yahoo WS) is push-native. A streaming router whose macro slot is empty is useless.

This spec ships both: the routing class for streaming, and a generic adapter that turns any `DataFeed` into a `StreamingDataFeed` by polling. Together they make replay-then-stream work for the equity+macro mix that motivated `RoutingDataFeed` in the first place.

The polling adapter is also useful standalone — for any vendor that ships only historical/REST access (CSV fixtures, low-update-rate feeds, internal datasets), it removes the need to write a streaming adapter just to satisfy `runLive`'s type signature.

## Non-goals

- **No changes** to `DataFeed`, `StreamingDataFeed`, `runBacktest`, `runLive`, `fromSpec`, `FeatureRuntime`, `BacktestExecutor`, or `Executor`. Both new pieces sit at the reference-impl layer.
- **No multi-frequency routing.** Each routed `StreamingDataFeed` decides its own tick cadence; the router doesn't aggregate or align across feeds. Multi-frequency strategies are out of scope (per Phase 9 design).
- **No bar synthesis from sub-bar ticks** in the polling adapter. It re-emits bars as the historical feed published them; it does not stitch ticks into bars. Bar aggregation remains the runtime's responsibility for genuinely streaming sources (per Phase 9 Decision #1).
- **No retry/backoff policy** baked into the polling adapter. Errors from the wrapped `feed.bars()` propagate to the consumer. Resilience policies are vendor-specific and belong in the vendor adapter.
- **No automatic capability discovery.** The router does not pre-scan inner feeds for `subscribe()`. Capability mismatches surface at construction time via TypeScript (the route map's value type is `StreamingDataFeed`).

## Part 1 — `RoutingStreamingDataFeed`

### Class shape

New file: `src/reference/routing-streaming-data-feed.ts`. Exports:

- `class RoutingStreamingDataFeed implements StreamingDataFeed`
- `class RoutingStreamingDataFeedError extends Error`
- `type RoutingStreamingDataFeedRouteMap`
- `type RoutingStreamingDataFeedRouteFn`

Constructor mirrors `RoutingDataFeed`:

```ts
type RoutingStreamingDataFeedRouteMap = Readonly<Partial<Record<Asset['kind'], StreamingDataFeed>>>;
type RoutingStreamingDataFeedRouteFn  = (asset: Asset) => StreamingDataFeed | undefined;

constructor(routes: RoutingStreamingDataFeedRouteMap | RoutingStreamingDataFeedRouteFn);
```

### `subscribe()` behavior

`subscribe(assets)` groups `assets` by routed feed (by reference identity), calls each routed feed's `subscribe(group)` once, and merges the resulting iterables.

```ts
subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar>;
```

Sequence per call:

1. **Group**. Walk `assets`; resolve each via `route(asset)`. If `undefined`, throw `RoutingStreamingDataFeedError` synchronously (matches `RoutingDataFeed.bars()`'s lazy-throw shape — error surfaces on first `next()`).
2. **Subscribe upstream**. For each unique routed feed, call `feed.subscribe(groupAssets)` once. Subscribing per-feed (not per-asset) preserves vendor-side aggregation: a Polygon adapter that opens one socket for `[AAPL, MSFT]` should keep doing that.
3. **Merge**. Race per-iterator `next()` promises and yield whichever resolves first. Continue until all upstream iterables are exhausted.

### Ordering, errors, cancellation

| Concern | Behavior |
|---|---|
| Per-asset ordering | Preserved — each upstream iterable already guarantees ascending `bar.t` for its own assets, and merging never reorders within a single iterator. |
| Cross-asset ordering | **Not guaranteed.** Matches the base `StreamingDataFeed` contract (`src/interfaces/streaming-data-feed.ts:23-25`). |
| Upstream error | Propagated to the consumer. Before re-throwing, call `return()` on every other iterator to release upstream resources. |
| Upstream early termination | If one iterator returns `done: true`, drop it and continue with the rest. The router itself returns done only when **all** upstream iterables have terminated. |
| Consumer cancellation (`break`) | The async generator's `return()` runs the cleanup branch — call `return()` on every still-live upstream iterator. |

### Edge cases

- **Empty `assets` array.** Return an immediately-done async iterable. Don't call any upstream `subscribe`.
- **All assets route to the same feed.** Single upstream `subscribe` call; merge is a no-op pass-through.
- **Some assets unroutable (mixed map form).** Throw on the first unroutable asset — no partial subscriptions. The error includes the offending `asset.kind` and `asset.id`. (Matches `RoutingDataFeed.bars()`'s "fail loud, fail early" stance — silently dropping assets would be a strategy-correctness bug.)
- **Upstream `subscribe` throws synchronously at call time.** Surfaces on the consumer's first `next()` (the router lazily wraps the merge in an async generator).
- **Upstream `subscribe` returns an iterable whose `next()` rejects on first call.** Same as a mid-stream error: cancel siblings, propagate.

### K-way merge implementation

The merge is the only non-trivial piece. The implementation tracks one pending `next()` promise per live iterator, races them, and after each resolution either yields the value (and re-arms that iterator's promise) or drops the iterator (on `done`). Cleanup invokes `return()` on each still-pending iterator.

A reference sketch (final code lives in the implementation file):

```ts
async function *merge(iters: ReadonlyArray<AsyncIterator<StreamingBar>>): AsyncGenerator<StreamingBar> {
  type Pending = { iter: AsyncIterator<StreamingBar>; promise: Promise<{ idx: number; r: IteratorResult<StreamingBar> }> };
  const live = new Map<number, Pending>();
  const arm = (idx: number, iter: AsyncIterator<StreamingBar>) => {
    live.set(idx, {
      iter,
      promise: iter.next().then((r) => ({ idx, r })),
    });
  };
  iters.forEach((iter, idx) => arm(idx, iter));

  try {
    while (live.size > 0) {
      const { idx, r } = await Promise.race([...live.values()].map((p) => p.promise));
      if (r.done) {
        live.delete(idx);
      } else {
        yield r.value;
        const slot = live.get(idx);
        if (slot) arm(idx, slot.iter);
      }
    }
  } finally {
    // Best-effort cleanup; ignore errors from individual return() calls.
    await Promise.allSettled([...live.values()].map((p) => p.iter.return?.(undefined)));
  }
}
```

Two correctness points:

1. **Re-arming on the same `idx`** rather than allocating a new id avoids unbounded growth across thousands of ticks.
2. **`finally` block** runs on consumer `break`, on `throw`, and on natural completion — covering all three exit paths.

### Why not alternatives

- **One unified `RoutingDataFeed` that implements both interfaces.** Rejected (revisited; same conclusion as the historical spec). The sibling split is honest about vendor capability — FRED has no native stream, CSV fixtures don't stream. Forcing both methods on one class either requires throw-stubs (lying about capability) or both-optional methods (capability becomes a runtime check). The sibling-router pattern preserves type-time capability declaration.
- **Don't ship a router; document a manual k-way merge recipe.** Rejected. The merge has subtle correctness issues (re-arming, cleanup on cancel/throw, `done`-handling) that cost more in user bugs than 80 lines of tested SDK code.
- **Per-asset `subscribe` calls.** Rejected. Vendor adapters often optimize per-call (one socket for many symbols). Calling once per asset would force adapters to fan internally or take an N× connection penalty.

## Part 2 — `pollingStreamFromHistorical`

### Function shape

New file: `src/reference/polling-stream-from-historical.ts`. Exports:

- `pollingStreamFromHistorical(opts): StreamingDataFeed`
- `type PollingStreamOptions`
- `type PollingSchedule`

```ts
export type PollingSchedule =
  | { kind: 'interval'; intervalMs: number }
  | { kind: 'session-close'; calendar: Calendar };

export type PollingStreamOptions = {
  /** Historical feed to poll. Each tick of the schedule calls `feed.bars(asset, …)` for each subscribed asset. */
  feed: DataFeed;
  /** Bar frequency to request. Single value — multi-frequency requires composing two polling streams via `RoutingStreamingDataFeed`. */
  freq: Frequency;
  /** When to poll. */
  schedule: PollingSchedule;
  /**
   * Window-start for the first poll per asset. Subsequent polls fetch
   * `(lastSeenT, now]` per asset. Defaults to `new Date(0)` — every bar the
   * feed has on the first poll is yielded. For replay-then-stream, set this
   * to your backtest range's `to` so polling picks up exactly where the
   * backtest left off and avoids re-yielding history already in `result.bars`.
   */
  initialFrom?: Date;
  /** Inject for testing. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Inject for testing. Defaults to `setTimeout`-based promise. */
  sleep?: (ms: number) => Promise<void>;
};

export function pollingStreamFromHistorical(opts: PollingStreamOptions): StreamingDataFeed;
```

### `subscribe()` behavior

Returns a `StreamingDataFeed` whose `subscribe(assets)` is an open-ended async generator:

1. Initialize `lastSeenT: Map<AssetId, Date>` to `opts.initialFrom ?? new Date(0)` for each asset.
2. Loop forever:
   1. `await waitForNextPoll()` — driven by `schedule`.
   2. For each asset (in input order, sequentially): call `feed.bars(asset, { from: lastSeenT.get(id)!, to: opts.now() }, freq)`. For each yielded bar with `bar.t > lastSeenT.get(id)`, yield `{ asset, bar }` and update `lastSeenT`.
   3. Continue.

### Schedule semantics

- **`{ kind: 'interval', intervalMs }`**: `setTimeout(intervalMs)` between polls. First poll happens after the initial sleep — gives the consumer time to begin iterating before the first batch lands.
- **`{ kind: 'session-close', calendar }`**: poll at the next session close strictly after `now()`. Resolved by calling `calendar.schedule({ from: now(), to: now() + N days })` (small forward lookahead, currently 14 days) and selecting the first `Session` whose `.close > now()`. The `Calendar` interface uses `Session.close` (not `.end`); see `src/interfaces/calendar.ts`. If the lookahead window contains no session (e.g. an exotic calendar with a multi-week holiday), sleep one day and retry — the poll loop never deadlocks.

The session-close schedule is the practical default for FRED-aligned macro polling: tactical/v1 evaluates at session close, so polling at the same cadence is right.

### Dedup semantics

Per-asset `lastSeenT` tracking guarantees:

- A bar with `t === lastSeenT` (re-published, no advance) is **not** yielded again. This is critical for FRED, which revises historical values without changing the publish date.
- A bar with `t < lastSeenT` (data correction with an older timestamp) is also dropped. This is intentional — the streaming contract requires ascending `t` per asset (`src/interfaces/streaming-data-feed.ts:23-25`); a backwards revision would violate downstream `appendBar` invariants (`src/features/runtime.ts:222-226`). If revisions matter to a strategy, they must be handled at the historical-replay layer, not the streaming layer.
- A bar with `t > lastSeenT` is yielded and `lastSeenT` advances.

### Edge cases

| Case | Behavior |
|---|---|
| `feed.bars()` yields zero bars | Continue to next asset / next poll. Don't yield, don't advance `lastSeenT`. |
| `feed.bars()` throws | Propagate to consumer (no internal retry). |
| `assets` empty | Return immediately-done iterable. No polling loop runs. |
| Same asset listed twice in `assets` | Deduplicate by `asset.id` at subscribe time. |
| Consumer cancels mid-poll | The polling generator's `try`/`finally` exits cleanly; no upstream cleanup needed (REST calls are short-lived). |

### Why a function, not a class

A class would carry no state across `subscribe()` calls (each call gets its own `lastSeenT` map by design — the consumer's `assets` set may differ between calls, and concurrent subscriptions must not share state). A factory function returning a `StreamingDataFeed` is the smaller surface.

### Why not alternatives

- **Bake polling into `RoutingStreamingDataFeed` as a "fallback when route is missing."** Rejected. Conflates two responsibilities: routing decides *which* feed; polling decides *how often* to drag data. They're orthogonal; a user might want to poll an entire vendor (no routing) or route between two streaming sources (no polling).
- **Have polling return individual bars instead of windows.** Rejected. The `DataFeed.bars()` window-API is what we have; calling it once per poll for `(lastSeenT, now]` is the natural shape. For schedules where one poll yields zero or one bars (FRED daily), the window is degenerate but correct.
- **Default `initialFrom` to `now()`.** Rejected. That would silently drop any bars published in the last interval. The conservative default (`epoch`) is wasteful on first poll for daily feeds (a few KB of FRED CSV) but never wrong; users replaying-then-streaming should pass `range.to` explicitly.

## Composition: the canonical replay-then-stream setup

```ts
import {
  runBacktest, runLive,
  RoutingDataFeed,
  RoutingStreamingDataFeed,
  pollingStreamFromHistorical,
  NYSEExchangeCalendar,
} from '@livefolio/sdk';

// Historical (backtest):
const histFeed = new RoutingDataFeed({
  equity: yahooHistorical,  // implements DataFeed
  macro:  fredHistorical,   // implements DataFeed
});

// Streaming (live):
const liveFeed = new RoutingStreamingDataFeed({
  equity: yahooStreaming,   // implements StreamingDataFeed (e.g. Polygon WS)
  macro:  pollingStreamFromHistorical({
    feed: fredHistorical,
    freq: '1d',
    schedule: { kind: 'session-close', calendar: nyse },
    initialFrom: range.to,
  }),
});

const result = await runBacktest({ /* …, dataFeed: histFeed */ });
for await (const ev of runLive({ /* …, dataFeed: liveFeed */ })) { /* … */ }
```

The macro slot of `liveFeed` is the polling adapter wrapping the same FRED `DataFeed` used in backtest — one historical adapter, two roles, zero duplicated code in user-land.

## Tests

### `RoutingStreamingDataFeed` (`src/reference/routing-streaming-data-feed.test.ts`)

Vitest, Vitest fake timers off (real microtasks). Mocked upstream feeds via `vi.fn()` returning hand-crafted async generators.

1. Map form: equity asset routes to equity feed's `subscribe`; macro asset routes to macro feed's `subscribe`. Each upstream `subscribe` is called **once**, with only its own assets.
2. Function form: predicate-based routing.
3. Empty `assets` array yields immediately-done iterable; no upstream calls.
4. Same upstream feed for all assets: one `subscribe` call with all assets passed through; merge is identity.
5. Two upstream feeds, interleaved ticks: ticks emerge in resolution order across upstreams; per-asset ordering preserved.
6. Upstream A finishes; upstream B continues — router yields B's remaining ticks; terminates when B finishes.
7. Upstream A throws mid-stream — router propagates the error; B's iterator's `return()` is called.
8. Consumer breaks the `for await` early — both upstreams' `return()` are called.
9. Unroutable asset (map form, kind not present) — first `next()` rejects with `RoutingStreamingDataFeedError`; no upstream subscribed.
10. Function form returns `undefined` for an asset — same error.

### `pollingStreamFromHistorical` (`src/reference/polling-stream-from-historical.test.ts`)

Inject `now` and `sleep` for deterministic timing. Mock `feed.bars()` via `vi.fn()` returning hand-crafted async generators per call.

1. Single asset, interval schedule: after first sleep, polls; new bars yielded; `lastSeenT` advances.
2. Two assets: each polled per cycle in input order; each tracks its own `lastSeenT`.
3. Empty `feed.bars()` result on a poll: nothing yielded; next poll covers `(prevLastSeen, newer-now]`.
4. Bar with `t === lastSeenT` re-published: not yielded.
5. Bar with `t < lastSeenT` (revised backwards): not yielded.
6. `feed.bars()` throws: error propagates to consumer.
7. `initialFrom` set: first poll's `from` is `initialFrom`, not epoch.
8. Empty `assets`: subscribe returns immediately; sleep never called.
9. Duplicate asset in `assets`: deduplicated by `id` (one poll per cycle, not two).
10. Session-close schedule: stub a calendar whose `next()` returns a fixed instant; assert `sleep(durationMs)` is called with the expected delay.

## Exports

`src/reference/index.ts`:

```ts
export { RoutingStreamingDataFeed, RoutingStreamingDataFeedError } from './routing-streaming-data-feed';
export type {
  RoutingStreamingDataFeedRouteFn,
  RoutingStreamingDataFeedRouteMap,
} from './routing-streaming-data-feed';
export { pollingStreamFromHistorical } from './polling-stream-from-historical';
export type {
  PollingStreamOptions,
  PollingSchedule,
} from './polling-stream-from-historical';
```

`src/index.ts` re-exports the same surface alongside the existing reference impls.

## Documentation (in plan scope, Task 4)

- New recipe: `docs-site/recipes/composing-streaming-data-feeds.md` — sibling of the historical `composing-data-feeds.md`, with its own runnable script under `scripts/docs/recipes/`. Reuses the SPY/TLT yield-gate strategy for continuity. Demonstrates `RoutingStreamingDataFeed` + `pollingStreamFromHistorical` wiring; explains *why* the macro slot polls instead of subscribing.
- VitePress sidebar entry under Recipes.
- See-also cross-links from `composing-data-feeds.md` and `replay-then-stream.md`.
- `src/reference/AGENTS.md` Key Files entries (handled in Task 3).

Skill cross-links (`livefolio-tactical-author`, `livefolio-custom-adapter`) are out of scope here — they pair with vendor adapter packages, which land separately.

## Future considerations (explicitly deferred)

- **`StreamingDataFeed` composition with bar aggregation across feeds.** If a user routes two equity feeds for the same asset (primary + fallback), de-duplication and tie-breaking become real questions. Not solving today.
- **Polling backoff/retry.** Vendor-specific. Belongs in the vendor adapter, not the generic polling helper.
- **Cron-style schedules.** `{ kind: 'cron', expr }` could land later if interval and session-close prove insufficient. Non-breaking to add.
- **`initialFrom` as `Map<AssetId, Date>`** for per-asset cutoffs. Non-breaking to add when a user actually needs it.
