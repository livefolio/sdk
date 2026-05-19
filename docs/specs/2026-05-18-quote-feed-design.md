# QuoteFeed — one-shot current-price interface

**Status:** Design
**Date:** 2026-05-18
**Scope:** v0.4 SDK interfaces

## Motivation

The v0.4 SDK has two market-data seams:

- `DataFeed` — range-bounded historical bars (`bars(asset, range, freq)`)
- `StreamingDataFeed` — open-ended live tick stream (`subscribe(assets)`)

Both are async-iterable. Neither answers "what is the current price of X, right now, as a single value." Today there are three workarounds, all unsatisfying:

1. **Subscribe and cache the latest tick.** Works once the stream is open, but pays the cost of an open WS subscription for a one-shot read, and the first read blocks until a tick arrives.
2. **Call `bars()` with a tiny trailing range.** Forces the historical adapter to serve a "near-now" query it was never designed for; most vendors return the prior session close, not a live quote.
3. **Read `LiveEvent.mark.prices`.** Only available inside an active `runLive` loop. Not usable from a UI handler, a one-shot CLI tool, or pre-trade order sizing.

Use cases driving the gap:

- **UI refresh button** — user clicks "refresh price" on a holdings table; we want a quote without standing up a stream.
- **Pre-trade order sizing** — before submitting an order, snap a quote to compute share count from a dollar target. (The order itself fills at the broker's price; the quote is just for sizing the request.)
- **One-shot CLI / script** — e.g. `livefolio quote AAPL` for ad-hoc checks.

These are pull-shaped, point-in-time queries with no `t` parameter. They don't fit either existing interface.

## Decision

Ship `QuoteFeed` as a third sibling interface alongside `DataFeed` and `StreamingDataFeed`. Adapters implement whichever subset matches what their vendor offers. The runtime/app composes feeds at the call site (`{ ...historical, ...streaming, ...quotes }`) the same way they compose the existing two.

This is the same split rationale the SDK already accepted for DataFeed vs StreamingDataFeed (see `src/interfaces/streaming-data-feed.ts:17-21`):

- Historical-only adapters (Yahoo CSV, parquet replays) have no "now" and cannot implement `QuoteFeed`.
- Streaming-only adapters (raw WS with no REST surface) would have to fake a quote by buffering the latest tick — pushing that complexity into every WS adapter is wrong; if a caller wants that behavior, a small `latestTickQuoteFeed(streamingFeed)` reference helper can wrap a `StreamingDataFeed`.
- Quote-only vendors exist (snapshot REST endpoints without bars or WS) — a separate interface lets them ship as a useful single-purpose adapter.
- Combined vendors (Alpaca, Polygon) implement all three on one class.

## Interface

```ts
// src/interfaces/quote-feed.ts
import type { Asset } from './types';

/**
 * A point-in-time quote for an asset. The `t` field is the timestamp the
 * vendor stamped on the quote — callers should treat it as the staleness
 * upper bound, not "now".
 */
export type Quote = {
  asset: Asset;
  /** Vendor-stamped quote time. */
  t: Date;
  /** Last trade price, or mid if the vendor only exposes bid/ask. */
  price: number;
  /** Best bid, when the vendor exposes Level 1 data. */
  bid?: number;
  /** Best ask, when the vendor exposes Level 1 data. */
  ask?: number;
  /** Bar/quote currency, when the vendor reports it. */
  currency?: string;
};

/**
 * One-shot current-price source. Sibling interface to {@link DataFeed} and
 * {@link StreamingDataFeed} — they are NOT a union and there is no
 * composition helper. Historical adapters implement `DataFeed.bars()`;
 * streaming adapters implement `StreamingDataFeed.subscribe()`; quote
 * adapters implement `QuoteFeed.quote()`. A vendor that offers all three
 * implements all three interfaces on one class.
 *
 * Implementations MUST guarantee:
 * - `quote` returns a freshly fetched `Quote` each call. Implementations MAY
 *   cache for a short TTL (e.g. 1s) to coalesce bursts; the TTL behavior
 *   MUST be documented on the adapter.
 * - The returned `Quote.t` is the vendor's stamp, not the local clock.
 * - `quote` rejects with a typed error if the asset is unsupported or the
 *   vendor is unreachable. It MUST NOT silently return a stale or fabricated
 *   price.
 */
export interface QuoteFeed {
  quote(asset: Asset): Promise<Quote>;
}
```

### Bulk quotes — `quoteBatch` (optional)

Most vendor quote endpoints accept a list of symbols and return a list in one round-trip. The interface stays minimal but exposes an optional batch method so adapters that have it can avoid N-round-trip storms:

```ts
export interface QuoteFeed {
  quote(asset: Asset): Promise<Quote>;
  quoteBatch?(assets: ReadonlyArray<Asset>): Promise<ReadonlyArray<Quote>>;
}
```

Callers that need batch can feature-detect:

```ts
const quotes = feed.quoteBatch
  ? await feed.quoteBatch(assets)
  : await Promise.all(assets.map(a => feed.quote(a)));
```

A small reference helper (`asQuoteBatch(feed)`) can wrap this fallback so callers don't repeat the branch.

## Non-goals

- **No streaming.** `subscribe()` already covers that.
- **No historical "quote as of t".** That's `DataFeed.bars()` with a single-day range — different shape, different vendor surface.
- **No L2 / order book.** `bid`/`ask` are Level 1 only. L2 is a separate interface if and when it's needed.
- **No automatic injection into `runLive` or `runBacktest`.** Neither runtime calls `QuoteFeed`. It's a separate seam the app reaches for explicitly. Tying it into runtime loops conflates pull-quote semantics with the push-stream contract `runLive` already owns via `LiveEvent.mark`.
- **No coupling to `Executor`.** Pre-trade sizing is a caller concern; the `Executor` interface stays focused on order routing. (A future spec could add a `Executor.quote()` for "what would my fill price be," but that's a broker concern, not a market-data concern — different surface, different spec.)
- **No staleness enforcement in the interface.** Callers decide what "too stale" means based on `Quote.t`. The SDK does not impose a TTL.

## Out-of-scope follow-ups

- **`latestTickQuoteFeed(streamingFeed: StreamingDataFeed): QuoteFeed`** — reference helper that subscribes once and serves the latest cached tick per asset. Useful for apps that already have a `StreamingDataFeed` and want a pull surface without standing up a second vendor connection. Worth shipping as a small reference impl in `src/reference/` after the interface lands.
- **Pre-trade quote on `Executor`.** If the broker exposes a "what would this fill at" endpoint, that's a different concern (asks the broker, not the market) and belongs on `Executor`, not here.
- **Quote routing.** A `RoutingQuoteFeed` mirroring `RoutingDataFeed` (route by `Asset.kind` to per-vendor quote adapters) is straightforward once `QuoteFeed` exists. Defer until a second quote-capable vendor lands.

## Open questions

- **`quoteBatch` ordering guarantee.** Should the returned array preserve the request order, or be keyed by asset id? Preserving order is simpler for callers (`zip(assets, quotes)`) but forces adapters that get back unordered vendor responses to re-sort. Lean: require order-preserving, document it, eat the re-sort cost in adapters.
- **Currency field.** Worth surfacing on `Quote` for multi-currency portfolios, or defer until a currency-conversion spec lands? Lean: include as optional now — it's cheap to add, awkward to retrofit.
- **Error typing.** Should `QuoteFeed.quote` throw a typed `QuoteFeedError` union (`unknown-asset` | `unreachable` | `rate-limited`) like the Alpaca executor spec did for `AlpacaExecutorError`, or just `Error` and let adapters subclass? Lean: typed union, consistent with the executor precedent in `2026-05-05-alpaca-executor-design.md`.

## Implementation sketch

1. Add `src/interfaces/quote-feed.ts` with `Quote` type and `QuoteFeed` interface.
2. Re-export `Quote` and `QuoteFeed` from `src/interfaces/index.ts` and `src/index.ts`.
3. Add `src/interfaces/quote-feed.test.ts` covering the contract via a typed mock (single `quote` call, batch fallback behavior).
4. Document the three-interface model (DataFeed / StreamingDataFeed / QuoteFeed) in `docs-site/` adapter recipes — likely a short addition to the existing custom-adapter recipe rather than a standalone page.
5. Defer the `latestTickQuoteFeed` helper and `RoutingQuoteFeed` to follow-up specs once a real consumer surfaces.
