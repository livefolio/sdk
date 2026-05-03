# Concepts

## The four-layer stack

`@livefolio/sdk` separates strategy authorship from runtime concerns through four distinct layers:

```
┌─────────────────────────────────────────┐
│  Strategy layer (TacticalSpec / rules)  │  ← you author this
├─────────────────────────────────────────┤
│  Execution layer (runBacktest / reconcile) │  ← SDK runtime loop
├─────────────────────────────────────────┤
│  Feature layer (FeatureRuntime / cache) │  ← SDK + FeatureCache interface
├─────────────────────────────────────────┤
│  Data / exchange layer                  │  ← DataFeed + Calendar interfaces
│  (market data, order routing, sessions) │
└─────────────────────────────────────────┘
```

**Strategy layer** — Your code. A `TacticalSpec` is plain data: universe, feature declarations, rebalance schedule, rule tree. No SDK types in your domain model; the spec is serializable and version-controlled.

**Execution layer** — `runBacktest` (and, for live use, `reconcile`). Walks calendar sessions, coordinates feature computation, evaluates the rule tree, dispatches orders to the executor, applies fills, records snapshots.

**Feature layer** — `FeatureRuntime` resolves named feature specs (e.g. `{ kind: 'sma', period: 100 }`) into numeric values for a given date. Results flow through `FeatureCache` so repeated runs are cheap.

**Data / exchange layer** — The pluggable seams. `DataFeed` supplies OHLCV bars. `Calendar` supplies trading-day arithmetic. `Executor` receives orders and returns fills. Swap any of these without touching strategy code.

---

## DataFeed

`DataFeed` is the market-data seam. It has one required method:

```ts
interface DataFeed {
  bars(
    asset: Asset,
    range: DateRange,
    freq: Frequency,
  ): AsyncIterable<Bar>;
}
```

**Contract:**
- Yields `Bar` objects (`{ t, open, high, low, close, volume }`) in ascending `t` order.
- `range` is half-open: bars with `t >= range.from && t < range.to` are included.
- If no bars exist for the requested asset and range, the iterable yields nothing (no error).
- Frequency is a hint (e.g. `'1d'`, `'1h'`); the feed is responsible for returning bars at that granularity.

**Optional extensions:**

`DataFeed` may also expose `fundamentals(asset, date)` and `events(asset, range)` for fundamental data and corporate events respectively. The core runtime does not require these; they are available for custom feature implementations.

**Reference:** none ships in the core SDK — `DataFeed` is purely an interface. The companion package `@livefolio/yfinance` is one implementation. You can write your own for any source (broker API, local CSV, cloud data warehouse).

See [`DataFeed`](/api/interfaces/DataFeed) and [`Bar`](/api/type-aliases/Bar).

For a walkthrough of implementing a custom feed, see Custom DataFeed in the Guides section.

---

## Executor

`Executor` is the order-routing seam. It receives a batch of `Order` objects on each rebalance event and returns `Fill` objects.

```ts
interface Executor {
  submit(orders: Order[], portfolio: Portfolio, t: Date): Promise<Fill[]>;
}
```

**Contract:**
- `orders` is the full intended rebalance (open, close, and adjust positions).
- Returns fills synchronously within the async call — fills may be partial.
- Unfilled orders are not automatically retried; the next rebalance re-evaluates from scratch.

**`BacktestExecutor`** — the reference implementation. Simulates fills at the next session's open price using a `nextOpen` callback you provide. Records fills, orders, and portfolio snapshots. No slippage modelling by default.

In production, swap `BacktestExecutor` for a `LiveBrokerExecutor` that talks to your broker's API. The strategy and runtime loop are identical.

See [`Executor`](/api/interfaces/Executor), [`BacktestExecutor`](/api/classes/BacktestExecutor), [`Order`](/api/type-aliases/Order), and [`Fill`](/api/type-aliases/Fill).

For a walkthrough of implementing a custom executor, see Custom Executor in the Guides section.

---

## Calendar

`Calendar` provides trading-day arithmetic. The runtime uses it to iterate sessions, determine rebalance days, and look up next/previous trading days.

```ts
interface Calendar {
  isOpen(t: Date): boolean;
  sessions(range: DateRange): Date[];
  next(t: Date): Date;
  previous(t: Date): Date;
}
```

**Reference implementations:**

- **`NYSEExchangeCalendar`** — New York Stock Exchange, 1885 to present. Covers era-varying weekmasks, all US federal holidays as they have changed over history, special early closes, and ad-hoc market closures (e.g. 9/11, Hurricane Sandy).
- **`LSEExchangeCalendar`** — London Stock Exchange, 1801 to present. Covers UK bank holidays, royal events, special sessions.

Both are ported from `pandas_market_calendars` and pass a parity test against the reference Python implementation.

**`getCalendar`** is a convenience factory:

```ts
import { getCalendar } from '@livefolio/sdk';
const calendar = getCalendar('NYSE'); // or 'LSE'
```

You can implement `Calendar` for any exchange — see Custom Calendar in the Guides section.

See [`Calendar`](/api/interfaces/Calendar), [`NYSEExchangeCalendar`](/api/classes/NYSEExchangeCalendar), [`LSEExchangeCalendar`](/api/classes/LSEExchangeCalendar), [`getCalendar`](/api/functions/getCalendar).

---

## FeatureCache

`FeatureCache` memoizes indicator results by a content-addressed key derived from `(feature spec, asset, date)`. Two feature specs with identical parameters and the same asset/date will always resolve to the same cache entry, even across separate `FeatureRuntime` instances.

```ts
interface FeatureCache {
  get(key: FeatureKey): Promise<number | undefined>;
  set(key: FeatureKey, value: number): Promise<void>;
}
```

**`MemoryFeatureCache`** — the reference implementation. Stores values in a `Map` in the current process. Sufficient for single-run backtests. No persistence across process restarts.

For cross-process or persistent caching (e.g. Redis, DynamoDB), implement `FeatureCache` with your preferred store. The `FeatureKey` type is a stable string you can use directly as a cache key.

**Why content-addressing matters:** if you run a backtest over 2020–2024 and then extend to 2025, the cache already holds all 2020–2024 indicator values. Only the new dates are computed.

See [`FeatureCache`](/api/interfaces/FeatureCache), [`MemoryFeatureCache`](/api/classes/MemoryFeatureCache), [`FeatureKey`](/api/type-aliases/FeatureKey).

For a walkthrough of implementing a persistent cache, see Custom FeatureCache in the Guides section.

---

## How the layers compose

On each trading session, `runBacktest` does the following:

1. **Check rebalance** — ask `Calendar` and `RebalanceConfig` whether today is a rebalance day (`isRebalanceDay`).
2. **Compute features** — if rebalancing, call `FeatureRuntime.resolve(features, date)`. Each feature spec is resolved by fetching bars from `DataFeed` (or from `FeatureCache` if already computed), running the indicator function (e.g. `sma`), and storing the result back in `FeatureCache`.
3. **Evaluate rule tree** — walk the `RuleNode` tree with the resolved feature values. The leaf `allocate` node produces target weights.
4. **Submit orders** — compare target weights to the current portfolio. Generate `Order` objects for the delta. Pass them to `Executor.submit`.
5. **Apply fills** — update the portfolio with the returned `Fill` objects.
6. **Record snapshot** — append a `BacktestSnapshot` to `result.snapshots`.

Each layer is independently testable: mock `DataFeed` with `vi.fn()`, use `MemoryFeatureCache` as a test fixture, or supply a deterministic `BacktestExecutor` that always fills at close.

---

## API reference quick-links

| Symbol | Kind | Link |
|---|---|---|
| `TacticalSpec` | type alias | [`/api/type-aliases/TacticalSpec`](/api/type-aliases/TacticalSpec) |
| `DataFeed` | interface | [`/api/interfaces/DataFeed`](/api/interfaces/DataFeed) |
| `Executor` | interface | [`/api/interfaces/Executor`](/api/interfaces/Executor) |
| `Calendar` | interface | [`/api/interfaces/Calendar`](/api/interfaces/Calendar) |
| `FeatureCache` | interface | [`/api/interfaces/FeatureCache`](/api/interfaces/FeatureCache) |
| `MemoryFeatureCache` | class | [`/api/classes/MemoryFeatureCache`](/api/classes/MemoryFeatureCache) |
| `BacktestExecutor` | class | [`/api/classes/BacktestExecutor`](/api/classes/BacktestExecutor) |
| `NYSEExchangeCalendar` | class | [`/api/classes/NYSEExchangeCalendar`](/api/classes/NYSEExchangeCalendar) |
| `LSEExchangeCalendar` | class | [`/api/classes/LSEExchangeCalendar`](/api/classes/LSEExchangeCalendar) |
| `runBacktest` | function | [`/api/functions/runBacktest`](/api/functions/runBacktest) |
| `fromSpec` | function | [`/api/functions/fromSpec`](/api/functions/fromSpec) |
