---
name: livefolio-custom-adapter
description: Use when implementing a custom DataFeed, Executor, Calendar, or FeatureCache for @livefolio/sdk — wrapping a market-data vendor, integrating a broker, modeling a non-NYSE/LSE exchange, or building a cross-process feature cache. Triggers on `implements DataFeed` / `implements Executor` / `implements Calendar` / `implements FeatureCache` declarations, or mentions of "custom data feed", "broker adapter", "exchange calendar", "feature cache backend".
---

# Implementing a custom runtime adapter

The SDK's pluggable interfaces (`DataFeed`, `StreamingDataFeed`, `Executor`, `Calendar`, `FeatureCache`) are how you swap any layer of the runtime without touching strategy code. Reference impls ship; build your own when you need a different vendor, broker, exchange, or cache backend. `DataFeed` is the historical (bounded-range) seam consumed by `runBacktest`; `StreamingDataFeed` is the additive sibling consumed by `runLive`.

## Per-interface contract summary

### DataFeed — `bars(asset, range, freq) → AsyncIterable<Bar>`

- **MUST** yield bars in **ascending `t` order**.
- `range.from` is **inclusive**, `range.to` is **exclusive**.
- `freq` is `'1m' | '5m' | '15m' | '1h' | '1d'`.
- Bars are total-return adjusted (splits + dividends baked in) — adapter is responsible for adjustment math.
- Optional `fundamentals(asset)` and `events(asset, range)` methods. Don't stub them with throwers — leave them undefined so feature-detection (`'fundamentals' in feed`) works.
- Reference: `@livefolio/yfinance` (sibling repo `~/Documents/Personal/livefolio-2/yfinance/`).

### StreamingDataFeed — `subscribe(assets) → AsyncIterable<StreamingBar>`

- Sibling interface to `DataFeed`, NOT a union, NOT a backward-compat alias — implement separately when you need live evaluation via `runLive`.
- `subscribe(assets)` returns an **open-ended** `AsyncIterable` — yields ticks as they arrive, never naturally completes (consumer breaks the loop).
- `StreamingBar = { asset: Asset; bar: Bar }` — the tick shape; ascending `bar.t` per asset.
- **No `freq` param.** The runtime owns aggregation; the `Calendar` defines session boundaries; `runLive` collapses ticks within a session and emits a `snapshot` event when the calendar advances. Your feed just emits raw ticks.
- Ticks may arrive **outside session hours** — runtime handles filtering. Don't drop them at the adapter layer (mark events fire on every tick for chart continuity, even pre-open).
- Typical shape: WebSocket adapter, polling adapter, message-queue consumer. Example skeleton:

```ts
import type { StreamingDataFeed, StreamingBar, Asset } from '@livefolio/sdk';

class MyWebsocketFeed implements StreamingDataFeed {
  async *subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar> {
    const ws = new WebSocket(this.url);
    const queue: StreamingBar[] = [];
    let resolve: (() => void) | null = null;
    ws.onmessage = (m) => {
      const tick = parseTick(m.data, assets);
      if (tick) {
        queue.push(tick);
        resolve?.();
        resolve = null;
      }
    };
    try {
      while (true) {
        if (queue.length > 0) yield queue.shift()!;
        else await new Promise<void>((r) => (resolve = r));
      }
    } finally {
      ws.close();
    }
  }
}
```

- For paper-trading or fixture playback, an in-memory generator that replays a `Bar[]` array with optional artificial delays works fine (see `src/strategy/run-live.test.ts` for a worked example).

### Executor — `submit(orders, t) → Promise<Fill[]>`

- **MUST** be idempotent given the same `Order[]` input. Calling `submit` twice with the same orders should produce equivalent fills (no double-execution).
- `Order` is a discriminated union — handle every variant: `Open`, `Close`, `Adjust`, `Rebalance`.
- Reference: `BacktestExecutor` (configurable slippage in bps + per-share fees + next-open fill via `nextOpen` callback).
- For live brokers: map `Order` → broker SDK call; handle partial fills, rejects, retries internally.

### Calendar — `isOpen | next | previous | sessions | schedule | isEarlyClose`

- All Date returns are **UTC midnight** (or whatever your timezone convention is — be consistent).
- `next(t)`/`previous(t)` are **strictly later/earlier** — never return `t` itself.
- Two paths:
  - Implement `Calendar` from scratch for non-exchange markets (crypto 24/7, custom session calendar).
  - Subclass `ExchangeCalendar` for exchange-style markets — get TZ-aware schedule resolution + per-year caching for free, just provide the 9 abstract hooks.
- Reference: `NYSEExchangeCalendar` / `LSEExchangeCalendar` (faithful ports of `pandas_market_calendars`); `Crypto24x7Calendar` (every day a single midnight-UTC-to-next-midnight session) is the starting point for crypto / always-on markets — implements `Calendar` directly without going through `ExchangeCalendar`.

### FeatureCache — `get(key) | set(key, value) | invalidate(prefix)`

- Keys are **content-addressed**: `(FeatureSpec, asset, date)`. Property order in the spec must NOT affect key equality (canonicalize before hashing).
- `get` returns `undefined` on miss (not throw).
- `invalidate(prefix)` removes everything matching the prefix tuple — used when underlying data changes.
- Reference: `MemoryFeatureCache` (in-process Map, no eviction).
- Common custom impls: Redis, filesystem (with mtime check), in-memory LRU.

## Semantic gotchas — the things that bite in review

**TZ drift in Calendar.** `Date.UTC(...)` for midnight stamps; never `new Date(year, month, day)` (that's local time). Test by comparing against a sample of NYSE half-days where the difference shows.

**Range half-open vs closed.** `range.to` is exclusive everywhere in the SDK. If your adapter receives `to = 2024-12-31` and includes 12-31's bar, you've shifted the universe by one day vs the rest of the runtime.

**Implicit ordering in DataFeed.** Yielding bars out of order (or duplicate `t`) breaks `FeatureRuntime`. Sort before yielding, even at the vendor wrapper layer.

**Idempotency in Executor.** Live brokers love their order-IDs but the SDK's contract is that calling `submit(sameOrders)` twice should equal calling it once. If you can't guarantee that downstream, dedupe at the adapter layer using `Order.id`.

**Eviction in FeatureCache.** `MemoryFeatureCache` doesn't evict — it grows unbounded for long backtests. If you wrap with LRU/TTL, document the eviction policy in your impl's class-level TSDoc.

**Aggregation belongs to the runtime, not the StreamingDataFeed.** It's tempting to make `subscribe(assets, freq)` and emit aggregated 1d bars from raw ticks. Don't. The runtime collapses ticks per session driven by the `Calendar`; if you pre-aggregate, you fight the runtime. Spec: `docs/specs/2026-05-02-v0.4-phase-9-streaming-design.md`.

## Pre-ship checklist

- [ ] Implements every method declared on the interface (TypeScript will complain — but check optional methods like `fundamentals`/`events` aren't stubbed with throwers if the contract says they're optional).
- [ ] Returns sorted/canonical output where the contract demands it.
- [ ] Handles **empty range** (returns nothing, doesn't throw).
- [ ] Handles **unknown asset** (throws clearly, doesn't silently return empty).
- [ ] Async behavior matches the contract (DataFeed yields, Executor returns a Promise, FeatureCache is sync `get`/`set`).
- [ ] At least one `*.test.ts` file exercises the contract directly (mock the upstream service, assert sort order, assert range semantics).
- [ ] Wired into a real `runBacktest` call once, end-to-end, to confirm the runtime actually drives it correctly.

## Reference reading

- Interface contracts: [`/api/interfaces/DataFeed`](../../docs-site/api/interfaces/DataFeed.md), [`/api/interfaces/Executor`](../../docs-site/api/interfaces/Executor.md), [`/api/interfaces/Calendar`](../../docs-site/api/interfaces/Calendar.md), [`/api/interfaces/FeatureCache`](../../docs-site/api/interfaces/FeatureCache.md).
- Reference impls: `src/reference/`, `src/calendars/`, `~/Documents/Personal/livefolio-2/yfinance/src/`.
- Full guides: docs site `/guides/runtime/custom-data-feed`, `/custom-executor`, `/custom-calendar`, `/custom-feature-cache`.
