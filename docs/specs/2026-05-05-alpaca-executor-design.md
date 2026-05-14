# Alpaca adapter package — `@livefolio/alpaca`

**Status:** Approved 2026-05-14
**Date:** 2026-05-05
**Scope:** v0.4 SDK reference implementation

## Motivation

The SDK ships exactly one `Executor`: `BacktestExecutor`, which fabricates fills from a `nextOpen(asset, t)` callback and never talks to a broker. `runLive` accepts any `Executor`, so the loop is structurally complete, but consumers wanting to actually trade must write the broker adapter themselves. The `livefolio-custom-adapter` skill covers how, and the `replay-then-stream` recipe documents the seam (`liveExecutor: Executor`), but no shipped implementation closes the loop end-to-end.

`@livefolio/alpaca` is the first broker adapter package we ship — a reference implementation against [Alpaca Markets](https://alpaca.markets) exposing three classes that together satisfy the full SDK runtime contract: `AlpacaExecutor` (order routing), `AlpacaDataFeed` (historical bars for backtests), and `AlpacaStreamingDataFeed` (real-time tick bars for live evaluation). All three share the same `keyId`/`secretKey` credentials, ship together under one release boundary, and are tree-shaken by consumers that only need a subset. The package serves three purposes:

1. **Prove the contract.** Stress-test `Executor`, `DataFeed`, and `StreamingDataFeed` against real broker/data round-trips (latency, partial fills, rejections, network blips, reconnects) so the interfaces are known to be implementable, not just typeable.
2. **Set the pattern.** A second adapter (IBKR, SnapTrade, Tradier) can crib the structure — order translation, idempotency wrapper, fill correlation, streaming reconnect logic — instead of redesigning each piece.
3. **Make `runLive` runnable out of the box** for the most common SDK user shape: US equities / ETFs, daily-or-coarser rebalance, no existing broker integration.

Alpaca was chosen over IBKR / SnapTrade for the first cut because it is pure stateless HTTPS (no long-running gateway process), has API-identical paper and live endpoints, supports fractional shares natively (which tactical rebalances routinely produce), exposes `client_order_id` for idempotency without server-side dedupe gymnastics, and provides a WebSocket trades stream suitable for degenerate-bar synthesis.

## Non-goals

- **No multi-broker routing.** `AlpacaExecutor` talks to one Alpaca account. A future `RoutingExecutor` (analogous to `RoutingDataFeed`) is out of scope here.
- **No interface changes** to `Executor`, `Order`, `Fill`, `runBacktest`, `runLive`. The adapter is an `Executor` like any other.
- **No options, multi-leg, or crypto.** Equities and ETFs only in v1. Crypto and options are documented as future variants but not implemented.
- **No order-replace / cancel-replace logic.** `Executor.submit` is one-shot. If a strategy needs to cancel or modify an in-flight order it must do so out-of-band; this spec does not extend `Executor` with cancel/replace.
- **No bracket / OCO / OTO orders.** Tactical strategies emit plain buy/sell orders; the bracket order types Alpaca supports add complexity without a corresponding `Order` shape.
- **No order pacing / rate-limit handling beyond a single retry on 429.** Tactical strategies submit small batches; sophisticated rate-limit pacing is a v2 concern.
- **No dependency on `@alpacahq/alpaca-trade-api`.** That package is JS-first with bolted-on TS declarations and pulls in `ws`, `axios`, and `polygon-io` glue we don't need. We call REST with `fetch` and (if we go event-driven) the standard `ws` library directly. ~200 LOC vs. a transitive dependency tree we don't audit.

## Background — current Alpaca API surface

(Confirmed against Alpaca docs and the official `@alpacahq/alpaca-trade-api@3.1.3` source on 2026-05-05.)

### Base URLs

| Mode | REST | WebSocket (trade updates) |
|---|---|---|
| Paper | `https://paper-api.alpaca.markets` | `wss://paper-api.alpaca.markets/stream` |
| Live | `https://api.alpaca.markets` | `wss://api.alpaca.markets/stream` |

Authentication: REST uses `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY` headers. WebSocket uses an `{ action: 'authenticate', data: { key_id, secret_key } }` first message followed by `{ action: 'listen', data: { streams: ['trade_updates'] } }`.

### REST endpoints we depend on

| Method | Path | Purpose |
|---|---|---|
| `POST`   | `/v2/orders` | Submit an order |
| `GET`    | `/v2/orders/{id}` | Poll a single order |
| `GET`    | `/v2/orders:by_client_order_id?client_order_id=…` | Idempotency lookup |
| `DELETE` | `/v2/orders/{id}` | Cancel an in-flight order (used only for poll-timeout cleanup) |

`POST /v2/orders` request fields we use: `symbol`, `qty` *or* `notional` (mutually exclusive), `side` (`buy|sell`), `type` (`market|limit|stop|stop_limit|trailing_stop`), `time_in_force` (`day|gtc|ioc|fok|opg|cls`), `client_order_id` (≤128 chars), `limit_price` (when `type=limit`), `extended_hours`. v1 will only emit `market`+`day` and `limit`+`day|gtc`.

### WebSocket trade-updates events

`stream: 'trade_updates'`, `data: { event, order, price?, qty?, timestamp, position_qty? }`. Event types: `new`, `fill`, `partial_fill`, `canceled`, `expired`, `done_for_day`, `replaced`, `rejected`, plus rare `pending_*`, `stopped`, `calculated`, `suspended`.

### Order status values

Common: `new`, `partially_filled`, `filled`, `done_for_day`, `canceled`, `expired`, `replaced`, `pending_cancel`, `pending_replace`. Rare: `accepted`, `pending_new`, `accepted_for_bidding`, `stopped`, `rejected`, `suspended`, `calculated`.

Terminal-with-fills: `filled`, `partially_filled` if cancelled mid-flight, `done_for_day`. Terminal-without-fills: `canceled`, `expired`, `rejected`. Everything else is non-terminal.

### Fractional shares

- Decimal `qty` is allowed for fractional-eligible assets (most US equities/ETFs).
- Fractional orders MUST use `type=market` and `time_in_force=day`. Other combinations 422.
- `notional` (dollar) orders are also permitted but we use `qty` exclusively because `Order.quantity` is already share-denominated.

## Design

### File layout

The package lives at `~/Documents/Personal/livefolio-2/alpaca/` (sibling repo, separate npm package `@livefolio/alpaca`):

```
~/Documents/Personal/livefolio-2/alpaca/
├── AGENTS.md
├── CLAUDE.md            -> AGENTS.md (single-file, like yfinance/fred)
├── LICENSE              MIT
├── README.md
├── package.json         "@livefolio/alpaca", peer-dep @livefolio/sdk@^0.4
├── tsconfig.json        strict, ES2022, bundler, noUncheckedIndexedAccess
├── tsup.config.ts       esm only, @livefolio/sdk external, treeshake
├── vitest.config.ts
├── eslint.config.js     ported from fred
├── .prettierrc          ported from fred
└── src/
    ├── index.ts                       public exports
    │
    ├── auth.ts                        shared APCA-API-KEY-ID / APCA-API-SECRET-KEY helper
    ├── errors.ts                      Alpaca{Executor,DataFeed,StreamingDataFeed}Error
    ├── errors.test.ts
    │
    ├── asset.ts                       Asset → Alpaca symbol mapping (equity only)
    ├── asset.test.ts
    │
    ├── bar-cache.ts                   range-aware in-memory cache (mirrors yfinance/fred shape)
    ├── bar-cache.test.ts
    │
    ├── frequency.ts                   '1m'|'5m'|... ↔ '1Min'|'5Min'|... map
    ├── frequency.test.ts
    │
    ├── _resolve-order.ts              Order → (side, qty) helper (ported from BacktestExecutor)
    ├── _resolve-order.test.ts         parity test vs SDK's BacktestExecutor
    │
    ├── alpaca-trading-client.ts       REST: api.alpaca.markets /v2/orders
    ├── alpaca-trading-client.test.ts
    ├── alpaca-executor.ts             AlpacaExecutor class
    ├── alpaca-executor.test.ts
    │
    ├── alpaca-data-client.ts          REST: data.alpaca.markets /v2/stocks/bars
    ├── alpaca-data-client.test.ts
    ├── alpaca-data-feed.ts            AlpacaDataFeed class
    ├── alpaca-data-feed.test.ts
    │
    ├── alpaca-stream-client.ts        WS: stream.data.alpaca.markets/v2/{feed}
    ├── alpaca-stream-client.test.ts
    ├── alpaca-streaming-data-feed.ts  AlpacaStreamingDataFeed class
    ├── alpaca-streaming-data-feed.test.ts
    │
    └── integration.test.ts            live paper-API test, env-gated
```

### Class shape

```ts
export type AlpacaExecutorOptions = {
  /** Alpaca API key id. */
  keyId: string;
  /** Alpaca API secret key. */
  secretKey: string;
  /**
   * Paper-trading mode. Default: `true`.
   *
   * Defaulting to paper is intentional — flipping to live trading requires
   * an explicit `paper: false` so a misconfigured environment cannot route
   * orders to a real account by accident.
   */
  paper?: boolean;
  /**
   * How submit() awaits fill confirmation. Default: `'poll'`.
   *
   * - `'poll'`   — submit, then GET /v2/orders/{id} every `pollIntervalMs`
   *                until the order reaches a terminal status.
   * - `'stream'` — hold a persistent trade_updates WebSocket and resolve
   *                when the matching event arrives. Lower latency, more
   *                state to manage. (v1 throws; forward-compat option.)
   */
  fillMode?: 'poll' | 'stream';
  /** Poll interval in `'poll'` fill mode. Default: 500ms. */
  pollIntervalMs?: number;
  /**
   * Maximum time submit() will wait for terminal status before
   * cancelling the order and reporting a partial/zero fill.
   * Default: 30_000ms.
   */
  pollTimeoutMs?: number;
  /**
   * Prefix for `client_order_id`. Useful when multiple strategies share an
   * Alpaca account so order ids don't collide and per-strategy queries
   * become trivial. Default: `'lf'`.
   */
  clientOrderIdPrefix?: string;
  /**
   * Time-in-force for orders that have a non-`market` type. Tactical
   * strategies emitting market orders ignore this. Default: `'day'`.
   */
  defaultTimeInForce?: 'day' | 'gtc';
  /**
   * Optional injection seam for testing. Defaults to global `fetch`.
   * Type matches the standard fetch signature.
   */
  fetchImpl?: typeof fetch;
};

export class AlpacaExecutor implements Executor {
  constructor(opts: AlpacaExecutorOptions);
  async submit(
    orders: ReadonlyArray<Order>,
    t: Date,
    portfolio: Portfolio,
  ): Promise<ReadonlyArray<Fill>>;
  /** Closes any persistent WS connection. No-op in `'poll'` mode. */
  async close(): Promise<void>;
}

export class AlpacaExecutorError extends Error {
  readonly code:
    | 'auth_failed'
    | 'duplicate_client_order_id'   // recoverable — handled internally
    | 'order_rejected'
    | 'poll_timeout'
    | 'rate_limited'
    | 'http_error'
    | 'network_error';
  readonly orderRef?: string;
  readonly httpStatus?: number;
  readonly cause?: unknown;
}
```

### Data feed surface

`AlpacaDataFeed` implements `DataFeed` over `AlpacaDataClient` (REST: `data.alpaca.markets/v2/stocks/bars`). It handles asset → symbol mapping, range translation (exclusive → inclusive), frequency translation, bar normalization (1d timestamps to UTC midnight; intraday to period-start UTC), an in-memory range-aware cache, and in-flight dedup for concurrent calls on overlapping ranges. Bars are always fetched with `adjustment=all` (splits + dividends) — this is not a constructor option because the SDK contract mandates total-return-adjusted bars.

```ts
export type AlpacaDataFeedOptions = {
  keyId: string;
  secretKey: string;
  feed?: 'iex' | 'sip';
  fetchImpl?: typeof fetch;
  /** Override the client (test injection). When set, the other opts are ignored. */
  client?: AlpacaDataClient;
};

export class AlpacaDataFeed implements DataFeed {
  constructor(opts: AlpacaDataFeedOptions);
  bars(asset: Asset, range: DateRange, freq: Frequency): AsyncIterable<Bar>;
  // No fundamentals, no events. Not declared on the instance (feature-detection contract).
}
```

### Streaming feed surface

`AlpacaStreamingDataFeed` implements `StreamingDataFeed` over `AlpacaStreamClient` (WebSocket: `stream.data.alpaca.markets/v2/{feed}`). It synthesizes one degenerate `Bar` per trade print (`o=h=l=c=price`, `v=size`), matching the `@livefolio/yfinance` browser streaming feed pattern. The runtime collapses ticks per session via the `Calendar`. Only the `trades` channel is subscribed; the `quotes` channel (NBBO updates) is not.

```ts
export type AlpacaStreamingDataFeedOptions = {
  keyId: string;
  secretKey: string;
  feed?: 'iex' | 'sip';
  /** Pass through to AlpacaStreamClient. */
  reconnectBaseDelayMs?: number;
  maxReconnectDelayMs?: number;
  onStatus?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
  onError?: (error: Error) => void;
  /** Override the underlying client (test injection). When set, all other opts are ignored. */
  client?: AlpacaStreamClient;
};

export class AlpacaStreamingDataFeed implements StreamingDataFeed {
  constructor(opts: AlpacaStreamingDataFeedOptions);
  subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar>;
  close(): void;
}
```

### `submit()` flow (poll mode)

```
for each Order in orders:
    1. resolve { asset, side, qty } via the same logic BacktestExecutor uses
       (see src/reference/backtest-executor.ts:resolveAsset). Skip if qty === 0.
    2. translate to AlpacaPostOrderRequest:
         symbol           = asset.symbol
         side             = 'buy' | 'sell'
         type             = qty has fractional component ? 'market' : 'market' (v1)
         time_in_force    = 'day'
         qty              = qty.toString()
         client_order_id  = `${prefix}-${order.id}`
    3. POST /v2/orders. Possible outcomes:
         a. 200 → got back { id, client_order_id, status, ... }
         b. 422 with body matching duplicate-id pattern →
              GET /v2/orders:by_client_order_id?client_order_id=…  (idempotency)
              treat returned order as ours. continue.
         c. 422 other / 403 / 4xx →
              throw AlpacaExecutorError({ code: 'order_rejected', orderRef, ... })
              (caller's responsibility — this is a programming error,
              not a transient broker condition)
         d. 429 →
              one retry after Retry-After header (default 1s).
              second 429 → throw AlpacaExecutorError({ code: 'rate_limited' }).
         e. network error →
              throw AlpacaExecutorError({ code: 'network_error' }) — caller decides retry.
    4. poll GET /v2/orders/{id} every pollIntervalMs:
         - terminal-with-fills (filled, done_for_day, partially_filled-if-cancelled):
             emit Fill { orderRef: order.id, t: filled_at, quantity: filled_qty,
                         price: filled_avg_price, fees: 0 }   // commissions are 0 at Alpaca
         - terminal-without-fills (canceled, expired, rejected):
             emit nothing (per Executor contract — orders with zero quantity are skipped)
         - non-terminal after pollTimeoutMs:
             DELETE /v2/orders/{id}  (best-effort cancel)
             throw AlpacaExecutorError({ code: 'poll_timeout', orderRef })
return collected Fills
```

Orders are submitted **sequentially**, not in parallel. Tactical batches are typically <20 orders and Alpaca's per-account rate limit (200 req/min) makes parallel submission a foot-gun without delivering meaningful latency improvement. We can revisit if real workloads need it.

### `submit()` flow (stream mode)

Identical to poll mode except step 4: instead of polling, the executor maintains a single persistent `trade_updates` WS connection (lazy-opened on first `submit()`, kept alive across calls, closed by `close()`). Each `submit()` registers a per-`client_order_id` listener that resolves on a terminal `event`. On reconnection, the executor refetches each pending order via `GET /v2/orders:by_client_order_id` to seed state — `trade_updates` does not replay missed events.

Stream mode is a strict superset of poll mode capability — it just trades poll latency for connection state. **v1 ships poll only.** Stream mode is documented here so the option type is forward-compatible.

### Order translation

| `Order.kind` | Resolution | Alpaca `side` | Alpaca `qty` |
|---|---|---|---|
| `open` long | direct | `buy` | `order.quantity` |
| `open` short | direct | `sell` | `order.quantity` |
| `close` | look up position by `positionId` | opposite of position side | `order.quantity ?? position.quantity` |
| `adjust` | look up position by `positionId`; compute `delta = target − current` | sign of delta | `\|delta\|` |
| `rebalance` | direct | sign of `order.delta` | `\|order.delta\|` |

This is exactly `BacktestExecutor.resolveAsset` (`src/reference/backtest-executor.ts:47-66` in the SDK repo). The shared helper is ported into `~/Documents/Personal/livefolio-2/alpaca/src/_resolve-order.ts` with a parity test against shared `Order` fixtures. The leading underscore marks it as a package-internal helper, not a public export.

### Idempotency

`Executor.submit` MUST be idempotent per `Order.id`. The contract:

> submitting the same `Order` array twice with the same ids MUST NOT double-fill positions

Implementation:

1. `client_order_id = ${prefix}-${order.id}`. `Order.id` is already required to be unique within a submit batch and stable across retries by the SDK contract.
2. On `POST /v2/orders` 422 with body matching Alpaca's duplicate-`client_order_id` error, the executor calls `GET /v2/orders:by_client_order_id` and treats the returned order as the original. Subsequent fill polling/streaming is identical.
3. The lookup-on-duplicate path is fully transparent — the caller observes a normal `Fill` (or terminal-without-fills, or error) regardless of whether their POST won the race or hit a dup.

This satisfies idempotency without requiring callers to track in-flight orders themselves.

### Error handling and `Executor` contract conformance

The `Executor` contract mandates:

- One `Fill` per executed order; orders that produce zero fills are omitted.
- Idempotent per order id.
- `fill.t >= t`.
- `submit` resolves only after execution is confirmed.

`AlpacaExecutor` satisfies:

- ✅ One `Fill` per executed order (poll waits for terminal status; orders ending `canceled/expired/rejected` are silently dropped).
- ✅ Idempotent (see above).
- ✅ `fill.t = filled_at` from Alpaca, which is wall-clock execution time and always >= submission time. Per the `runLive` snapshot semantics, `t` (the SDK's logical "now") is the session-close timestamp, and `filled_at` is necessarily after it.
- ✅ Resolves only after confirmation (terminal status before the Promise resolves).

`AlpacaExecutorError` is thrown for unrecoverable conditions; transient errors are absorbed by retry inside `submit()`. Errors do **not** abort the rest of the batch — failed orders are skipped and others continue via the skip-and-continue semantics with an optional `onOrderError(err, order)` callback (see resolved decision 3 below).

### Fees

Alpaca commissions are zero on equities and ETFs at the time of writing. `Fill.fees` is set to `0`. SEC/FINRA pass-through fees on sells are settled out-of-band by Alpaca and are not surfaced per-fill. If we later need to attribute these per-fill, a `feeModel` constructor option can be added; v1 reports zero.

### Concurrency

`submit()` is not safe to call concurrently from multiple callers against the same `AlpacaExecutor` instance — Alpaca's `client_order_id` uniqueness is per-account, and concurrent batches with overlapping `Order.id`s would cross-contaminate. `runLive` calls `submit()` serially per session boundary, so this is not an issue in the standard path. Documented as a constructor-level invariant.

## Testing strategy

### Unit tests (`alpaca-executor.test.ts`)

Mock `fetchImpl`. Cover:

- Single buy order, single fill — happy path. Verify request body shape, headers, returned `Fill`.
- Single sell order on a fractional position — verify `qty` is decimal string.
- Five-order batch — verify sequential submission and full `Fill[]` return.
- 422 duplicate `client_order_id` → triggers GET-by-client-order-id and continues.
- 422 other → throws `AlpacaExecutorError({ code: 'order_rejected' })`.
- 429 → retries once, succeeds; second 429 → throws.
- Order ends `canceled` → omitted from `Fill[]` (zero-fill skip).
- Order ends `partially_filled` after timeout → emits `Fill` with `filled_qty` < requested, then DELETE is issued.
- Poll timeout on stuck `new` → throws `poll_timeout`, DELETE issued.
- `paper: false` constructor → URLs flip to live endpoints. (Verify via mock; never actually hit live.)

### Integration test (`alpaca-executor.live.test.ts`)

Skipped unless `ALPACA_PAPER_KEY_ID` and `ALPACA_PAPER_SECRET_KEY` env vars are set. Hits Alpaca's paper endpoint:

- End-to-end submit → fill round-trip on a single market order during market hours (requires test be run on a weekday between 9:30–16:00 ET; document this).
- `client_order_id` collision: submit twice with same id, assert second call returns same fill, no double-fill on account positions.
- Cleanup hook: closes any leftover positions/orders.

CI runs unit tests only by default. The live test is documented as a pre-merge manual check for changes that touch `AlpacaExecutor`.

## Resolved decisions (2026-05-14)

The eight open questions in the prior draft are resolved as follows. Full rationale lives in `docs/plans/2026-05-14-alpaca-adapter-package.md` under "Scope decisions."

| Q | Decision |
|---|---|
| 1. Separate package vs in-tree | **Separate package** `@livefolio/alpaca` at `~/Documents/Personal/livefolio-2/alpaca/`. |
| 2. Executor `fillMode: 'poll'` vs `'stream'` for v1 | **Poll only.** Type keeps `'poll' \| 'stream'`; `'stream'` throws. Forward-compat without an API break. |
| 3. Batch error semantics | **Skip-and-continue** with optional `onOrderError(err, order)` callback. Auth/network errors stay fatal and abort the batch. |
| 4. 422 duplicate `client_order_id` body shape | Match `/client[\s_-]?order[\s_-]?id/i` on response body text. Regex pinned via live-paper integration test. |
| 5. Closed-market behavior | **Document, don't guard.** Default `pollTimeoutMs = 30_000`; `Infinity` allowed. One-shot `console.warn` if poll exceeds half the timeout without status change. |
| 6. Calendar dependency in executor | **None.** Executor stays calendar-free. |
| 7. Startup reconciliation | **Out of scope for v0.1.** Documented as a future `reconcile(t)` method. |
| 8. Non-equity `Asset.kind` | **Throw loudly** via `AlpacaExecutorError({ code: 'unsupported_asset' })` (and `AlpacaDataFeedError` symmetrically for the data feed). |

### Cross-cutting decisions added when the package scope broadened

| | Decision |
|---|---|
| Three-class package | `AlpacaExecutor` + `AlpacaDataFeed` + `AlpacaStreamingDataFeed` ship together in `@livefolio/alpaca@0.1.0`. One credentials story, one release boundary. |
| Three separate REST/WS clients | `AlpacaTradingClient` (`api.alpaca.markets`), `AlpacaDataClient` (`data.alpaca.markets`), `AlpacaStreamClient` (`stream.data.alpaca.markets`). Different hosts, rate limits, response shapes. Shared only by `buildAuthHeaders`. |
| Order resolution helper | `BacktestExecutor.resolveAsset` is **ported** into the alpaca repo as `_resolve-order.ts` with a parity test against shared `Order` fixtures. Avoids coupling the SDK to a new public utility. |
| Data feed adjustment | Always `adjustment=all` (splits + dividends). Not a constructor option — the SDK contract mandates total-return-adjusted bars. |
| Streaming feed subscription type | Subscribe to Alpaca's `trades` channel; emit one degenerate `Bar` per print (`o=h=l=c=price`, `v=size`). Mirrors the `@livefolio/yfinance` browser streaming feed. Quotes channel **not** subscribed. |
| Node version | `engines.node: ">=22"`. Node 20 is EOL as of April 2026; the only consumer (`../app`) runs on Vercel's Node 22 default. No `ws` runtime dep — uses native `WebSocket`. |

## Implementation plan

Detailed implementation plan: `docs/plans/2026-05-14-alpaca-adapter-package.md`.

## Related docs

- `docs/specs/2026-04-29-v0.4-multi-repo-interface-design.md` — `Executor` interface contract.
- `docs/specs/2026-05-02-v0.4-phase-9-streaming-design.md` — `runLive` event loop that consumes `Executor`.
- `docs-site/recipes/replay-then-stream.md` — the canonical `liveExecutor` seam.
- `src/reference/backtest-executor.ts` — the simulation `Executor`; shared `resolveAsset` helper originates here.
- `.claude/skills/livefolio-custom-adapter/` — the authoring guide for new `Executor` implementations.
