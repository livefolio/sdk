# RoutingQuoteFeed — multi-source QuoteFeed composition

**Status:** Design
**Date:** 2026-05-18
**Scope:** v0.4 SDK reference implementation

## Motivation

The v0.4 SDK now has three sibling market-data interfaces — `DataFeed`, `StreamingDataFeed`, and `QuoteFeed` (added in `docs/specs/2026-05-18-quote-feed-design.md`). The first two each have routing reference implementations (`RoutingDataFeed`, `RoutingStreamingDataFeed`) that multiplex per-vendor adapters behind a single interface; `QuoteFeed` does not.

The asymmetry is the headline reason to fix this. Once tactical strategies start consuming `QuoteFeed` (UI refresh, pre-trade sizing, ad-hoc CLI), the same vendor-split problem surfaces: equity quotes from one vendor (Alpaca / Polygon / Yahoo REST), macro "quotes" from a polling adapter wrapping a historical-only vendor (FRED), and the app wants one `QuoteFeed` to hand to its quote-consuming code.

The companion spec deferred this as "wait for a second quote-capable vendor." The deferral was conservative — the routing pattern is proven twice, the asymmetry of having two-of-three siblings carry routers is worse than the marginal benefit of designing against two real adapters, and `quoteBatch` adds genuinely new routing logic that's better worked out now than under deadline pressure for an app feature.

## The new wrinkle — `quoteBatch` is harder to route than `bars` or `subscribe`

`RoutingDataFeed.bars(asset, …)` and `RoutingStreamingDataFeed.subscribe(assets)` both have a clean one-shot dispatch shape:

- `bars` is per-asset — one route lookup, one delegated call, done.
- `subscribe` takes a list but its return is an open-ended iterable; the router groups by route, opens one subscription per group, and k-way merges the resulting tick streams. Order across groups isn't required by the contract.

`QuoteFeed.quoteBatch(assets) → Promise<ReadonlyArray<Quote>>` is different:

- It takes a list **and** returns a list.
- The `QuoteFeed` spec mandates **request-order preservation**: `result[i]` corresponds to `assets[i]`.
- So routing has to split, dispatch in parallel, and **re-collect into a single array indexed by the original request position** — the other two routers don't face this because their results are iterables, not arrays.

This is still small (a single index-tracking pass + `Promise.all`), but it's the one piece of `RoutingQuoteFeed` that isn't a copy-paste of `RoutingDataFeed`.

## Design

### Class shape

New file: `src/reference/routing-quote-feed.ts`. Exports:

- `class RoutingQuoteFeed implements QuoteFeed`
- `class RoutingQuoteFeedError extends Error`
- `type RoutingQuoteFeedRouteFn = (asset: Asset) => QuoteFeed | undefined`
- `type RoutingQuoteFeedRouteMap = Readonly<Partial<Record<Asset['kind'], QuoteFeed>>>`

Constructor mirrors the sibling routers exactly:

```ts
constructor(routes: RoutingQuoteFeedRouteMap | RoutingQuoteFeedRouteFn);
```

Map form is the 90% case. Internally normalized to `RouteFn`:

```ts
const route: RoutingQuoteFeedRouteFn =
  typeof routes === 'function' ? routes : (a) => routes[a.kind];
```

### Method behavior

| Method | Behavior |
|---|---|
| `quote(asset)` | `route(asset)` → delegate. If route returns `undefined`, throw `RoutingQuoteFeedError` with `asset.kind` and `asset.id` in the message. |
| `quoteBatch(assets)` | **Always defined on the router** — even if some inner feeds lack it, the router can fall back per-bucket. See below. |

### `quoteBatch` algorithm

```
1. If assets.length === 0 → return [].
2. Walk assets, building a Map<QuoteFeed, Array<{ asset, originalIndex }>>.
   For each asset:
     - Resolve route. If undefined → throw RoutingQuoteFeedError (before any vendor call).
3. For each (feed, bucket) entry:
     - If feed.quoteBatch is defined:
         results = await feed.quoteBatch(bucket.map(b => b.asset))
       Else:
         results = await Promise.all(bucket.map(b => feed.quote(b.asset)))
     - Pair each result back to its originalIndex.
4. Allocate output array of length assets.length. Place each (originalIndex, quote) pair.
5. Return.
```

Steps 3a (per-bucket) are dispatched in parallel via `Promise.all` over the bucket entries.

**Failure mode:** if any bucket rejects, the whole `quoteBatch` call rejects with that error. Matches `Promise.all` semantics; matches the "fail-fast on first missing route" behavior in step 2; matches how `RoutingStreamingDataFeed` throws on first unroutable asset during grouping. No partial-results mode in v1.

### Edge cases

- **Empty asset list:** `quoteBatch([])` resolves to `[]` without invoking any route lookup or inner feed.
- **All assets route to one feed:** still goes through the group-then-dispatch path, but with one bucket. Output is in request order regardless.
- **Single asset in `quoteBatch`:** goes through the same path. No special-case to `feed.quote(asset)` — keeps the code one shape.
- **Unknown `asset.kind` in map form:** throw `RoutingQuoteFeedError` during the grouping pass (step 2), *before* any vendor call is made. Same shape as the sibling routers.
- **Function form returns `undefined`:** throw `RoutingQuoteFeedError`. Same error class, same message pattern.
- **Routed feed throws from `quote()` or `quoteBatch()`:** error propagates unchanged — the router does not wrap vendor errors. Consistent with `RoutingDataFeed` and `RoutingStreamingDataFeed`.

### Why not alternatives

- **Skip `quoteBatch` on the router; only implement `quote`.** Rejected. Defeats the point — every caller would feature-detect and fall back to N round-trips, even when the underlying vendors do support batch. The router exists to be the smart layer.
- **Always fan out per-asset (`Promise.all(assets.map(a => this.quote(a)))`).** Rejected. Loses vendor-side batching: a vendor that accepts `[AAPL, MSFT, GOOG]` in one HTTP call would be hit three times.
- **Partial-results mode (`{ ok, errors }` return shape).** Rejected for v1. None of the sibling routers do this, none of the underlying interfaces do this, and tactical strategies don't need it. Can be added non-breakingly later as `quoteBatchSettled()` if a real use case appears.
- **Validate routes at construction (pre-scan inner feeds for batch support).** Rejected. Matches the "no capability introspection at construction" stance from `RoutingDataFeed`; failure surfaces at call time with a clear message.

## Tests

Co-located file `src/reference/routing-quote-feed.test.ts`, Vitest, mocked inner feeds via `vi.fn()`:

1. Map form routes `quote()` by `asset.kind` — equity asset hits the Alpaca mock, macro asset hits the FRED-polling mock.
2. Function form routes `quote()` via predicate.
3. `quote()` throws `RoutingQuoteFeedError` for unknown `asset.kind` (map form), mentioning `asset.kind` and `asset.id`.
4. `quote()` throws `RoutingQuoteFeedError` when function form returns `undefined`.
5. `quoteBatch([])` resolves to `[]` without invoking any route lookup.
6. `quoteBatch()` preserves request order — given `[macro, equity, equity, macro]`, the returned array has the right shape at each index.
7. `quoteBatch()` calls each inner feed's `quoteBatch` with **only** that feed's grouped assets (one call per inner feed, not per asset).
8. `quoteBatch()` falls back to `Promise.all(group.map(quote))` when the inner feed has no `quoteBatch` — verified by mocking a feed with only `quote` and checking it's called N times.
9. `quoteBatch()` throws `RoutingQuoteFeedError` before any inner-feed call when any asset is unroutable.
10. `quoteBatch()` rejects with the inner error when an inner feed's batch call rejects.

## Exports

Add to `src/reference/index.ts` and `src/index.ts` alongside `RoutingDataFeed` / `RoutingStreamingDataFeed`:

```ts
export { RoutingQuoteFeed, RoutingQuoteFeedError } from './reference/routing-quote-feed';
export type { RoutingQuoteFeedRouteFn, RoutingQuoteFeedRouteMap } from './reference/routing-quote-feed';
```

## Non-goals

- **No type changes to `QuoteFeed` or `Quote`.** The router is a `QuoteFeed`; the interface stays untouched.
- **No runtime wiring.** `runBacktest` and `runLive` still don't call any `QuoteFeed`. The router doesn't change that — it's app-side composition, same as the interface itself.
- **No `latestTickQuoteFeed(streamingFeed)`.** Still parked from the `QuoteFeed` spec. Orthogonal to routing.
- **No quote-feed adapter packages.** Implementing `QuoteFeed` in `@livefolio/yfinance` or the Alpaca adapter is separate work; this spec just provides the multiplexer they'll plug into.
- **No partial-results / `quoteBatchSettled()`.** Defer until a consumer needs it.

## Documentation (follow-up, not in this spec's implementation)

- Short addition to the custom-adapter recipe noting the three sibling routers (DataFeed, StreamingDataFeed, QuoteFeed).
- Cross-link from any docs that mention `QuoteFeed` once a vendor implementation lands.

## Future considerations (explicitly deferred)

- **`quoteBatchSettled`** — partial-results variant. Non-breaking to add later.
- **Throttling / batching across `quote()` calls.** A caller hammering `quote()` per asset could be coalesced into a single `quoteBatch` by a smart router. Out of scope; if real, ships as a separate decorator (`coalescingQuoteFeed(feed, { windowMs })`).
- **Capability-aware routing** — e.g. route to whichever inner feed has freshest data. Out of scope; routing stays kind-driven for symmetry with the sibling routers.
