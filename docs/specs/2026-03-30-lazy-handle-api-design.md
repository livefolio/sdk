# Lazy Handle API — Tickers & Indicators

## Overview

Replace the SDK's module-based architecture with a lazy handle pattern. Handles are lightweight objects that carry identity params and defer DB resolution until data is accessed. This enables declarative strategy composition where setup reads like a spec, not imperative DB operations.

Scope: tickers and indicators only. Signals, allocations, and strategies will follow the same pattern later.

## TickerHandle

```ts
const spy = sdk.ticker('SPY')        // leverage defaults to 1
const spy3x = sdk.ticker('SPXL', 3)  // explicit leverage
```

Stores `{ symbol, leverage }`. On resolution, upserts via the unique `(symbol, leverage)` constraint and caches the row.

**Public API:**
- `resolve()` — returns the DB row (triggers upsert if not cached)
- `id` — getter, throws if not yet resolved

Tickers are leaf nodes — no series data, just identity anchors for indicators.

## IndicatorHandle

Type-specific factory methods on the SDK client, each returning an `IndicatorHandle`:

### Ticker-bound indicators

```ts
sdk.sma(ticker, lookback, opts?)
sdk.ema(ticker, lookback, opts?)
sdk.price(ticker, opts?)
sdk.returns(ticker, lookback, opts?)
sdk.volatility(ticker, lookback, opts?)
sdk.drawdown(ticker, lookback, opts?)
sdk.rsi(ticker, lookback, opts?)
```

### Standalone indicators (no ticker)

```ts
sdk.vix(opts?)
sdk.vix3m(opts?)
sdk.treasury(tenor, opts?)    // 'T3M' | 'T6M' | ... | 'T30Y'
sdk.calendar(period, opts?)   // 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year'
```

### Threshold (constant value)

```ts
sdk.threshold(value, unit?)   // unit: '%' | '$' | undefined
```

### Options

`opts` is always `{ delay?: number }` — defaults to `0`. This is the only param not determined by the factory.

### Internals

Each factory sets the correct `type`, `lookback`, `delay`, `unit`, `threshold` defaults for its indicator kind. All create an `IndicatorHandle` with the full identity tuple: `{ type, tickerHandle?, lookback, delay, unit, threshold }`.

**Public API:**
- `resolve()` — returns the DB row
- `series(range?)` — returns `IndicatorSeries[]` for a date range
- `value(date?)` — returns the latest (or specific date) series value
- `id` — getter, throws if unresolved

## Resolution Mechanics

Resolution is lazy — no DB calls until `.value()`, `.series()`, or `.resolve()` is called.

```
sma.value()
  → sma._resolve()            // first call: not cached
    → spy._resolve()           // resolves ticker dependency first
      → upsert tickers         // ON CONFLICT (symbol, leverage) DO NOTHING, RETURNING *
      → caches row
    → upsert indicators         // uses spy.id from resolved ticker
    → caches row
  → queries indicators_series   // WHERE indicator_id = ? ORDER BY trading_day_id DESC LIMIT 1
  → returns value
```

**Memoization:** `_resolve()` is cached per handle instance. Subsequent calls return immediately. Two handles with the same params resolve independently (both hit DB once, get same row via upsert). No global cache.

**Data queries:** `.series()` and `.value()` always re-query (series data changes daily). Only the identity resolution is memoized.

**Error handling:** If an upsert fails (e.g. RLS blocks writes), the error propagates from the calling method. No silent failures.

## File Structure

```
sdk/src/
  handles/
    ticker.ts          # TickerHandle class
    indicator.ts       # IndicatorHandle class + factory logic
    index.ts           # barrel export
  database.types.ts    # generated (exists)
  types.ts             # business types, handle interfaces
  client.ts            # createClient + factory methods
  index.ts             # barrel export
```

## Changes to Existing Code

- Remove old `strategy/` and `evaluation/` module directories (from previous plan, not yet fully implemented)
- Remove subpath exports for `./strategy` and `./evaluation` from `package.json`
- Replace `LivefolioClient` interface with the new client shape exposing factory methods
- Wire `Database` type into `SupabaseClient<Database>` (already done)

## Design Decisions

**Lazy over eager:** For backtesting, strategy setup should read like a declaration. Lazy handles let you compose a full graph before any DB interaction, and the backtest runner can batch-resolve the entire dependency tree.

**Type-specific constructors over generic:** `sdk.sma(spy, 200)` is clearer than `sdk.indicator(spy, 'SMA', { lookback: 200 })`. Each factory knows its defaults and which params matter.

**Class-based handles:** Handles need mutable internal state (resolved vs unresolved, cached row) and shared behavior (`.series()`, `.value()`). Classes model this cleanly and are easy to debug/inspect.

**Per-instance memoization, no global cache:** Keeps the implementation simple. Two handles with the same params both upsert (idempotent, same result). Avoids cache invalidation complexity.
