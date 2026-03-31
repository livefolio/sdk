# Indicator Sync — Fetch, Compute, Cache

## Overview

Extend IndicatorHandle so that `series()` and `value()` transparently fetch from external APIs, compute derived values, and upsert to the DB when data is missing or stale. Once a trading day's market closes, that day's data is immutable — enabling aggressive in-memory caching.

## Provider Layer

Two provider modules fetch raw daily data from external APIs:

### Yahoo Finance (`providers/yahoo.ts`)

```ts
fetchDaily(symbol: string, from?: string): Promise<DailyBar[]>
```

Serves: Price, VIX, VIX3M (and indirectly all computed indicators that depend on price).

Symbol mapping:
- Ticker symbols pass through directly (SPY → `SPY`)
- VIX → `^VIX`
- VIX3M → `^VIX3M`

Fetches full history when `from` is omitted. Incremental when `from` is provided (only days after that date).

No API key required.

### FRED (`providers/fred.ts`)

```ts
fetchDaily(seriesId: string, apiKey: string, from?: string): Promise<DailyBar[]>
```

Serves: Treasury rates.

Series ID mapping:
- T3M → `DGS3MO`
- T6M → `DGS6MO`
- T1Y → `DGS1`
- T2Y → `DGS2`
- T3Y → `DGS3`
- T5Y → `DGS5`
- T7Y → `DGS7`
- T10Y → `DGS10`
- T20Y → `DGS20`
- T30Y → `DGS30`

Both providers return `DailyBar[]` (`{ date: string, value: number }`). Pure I/O, no computation.

## Computation Layer

Pure functions that transform a raw price series into computed indicator values:

```ts
sma(prices: DailyBar[], lookback: number): DailyBar[]
ema(prices: DailyBar[], lookback: number): DailyBar[]
rsi(prices: DailyBar[], lookback: number): DailyBar[]
returns(prices: DailyBar[], lookback: number): DailyBar[]
volatility(prices: DailyBar[], lookback: number): DailyBar[]
drawdown(prices: DailyBar[], lookback: number): DailyBar[]
```

Calendar indicators (Month, Day of Week, Day of Month, Day of Year) are derived from `trading_days.date` — pure date math, no external fetch.

Threshold indicators are constant values — no fetch or computation.

Indicator types that need no computation (stored directly from provider):
- Price — raw Yahoo close prices
- VIX, VIX3M — raw Yahoo data
- Treasury rates — raw FRED data

## Sync Flow

When `series()` or `value()` is called on an IndicatorHandle:

1. **Resolve** — upsert ticker + indicator rows (existing behavior)
2. **Check freshness** — query latest `trading_day_id` in `indicators_series` for this indicator. Compare against the latest closed trading day (query `trading_days` where `close < now()`). If there's a gap, sync is needed.
3. **Sync dependencies** — if this is a computed indicator (SMA, EMA, RSI, etc.), its Price dependency must be fresh first. The handle creates an internal Price IndicatorHandle and triggers its sync. Dependency resolution is recursive.
4. **Fetch and compute**:
   - For raw indicators (Price, VIX, treasury): call the appropriate provider with `from` set to the latest existing date for incremental fetch
   - For computed indicators: read the (now-fresh) Price series from DB, run the computation function
5. **Upsert** — write computed `DailyBar[]` to `indicators_series`, mapping dates to `trading_day_id` via the `trading_days` table
6. **Query** — read from `indicators_series` (existing behavior)
7. **Cache in-memory** — store `DailyBar[]` on the handle instance. Subsequent calls return from memory.

### Freshness Logic

Series data is immutable once a trading day's market closes. The cache is invalidated only when:
- A new trading day has closed since the last sync (compare cached latest date against latest closed trading day)
- The handle has never been synced (empty series)

### Dependency Chain

All computed indicators depend on the Price indicator for the same ticker. The chain is:
```
SMA(SPY, 200) → Price(SPY) → Yahoo Finance
EMA(SPY, 50)  → Price(SPY) → Yahoo Finance (already fresh from SMA)
RSI(SPY, 14)  → Price(SPY) → Yahoo Finance (already fresh)
VIX           → Yahoo Finance (direct, no dependency)
T10Y          → FRED (direct, no dependency)
```

Because Price handles cache their resolved state, multiple computed indicators sharing the same ticker only trigger one Yahoo fetch.

## Client Config

```ts
const sdk = createClient({
  supabase,
  fredApiKey: 'abc123',  // optional
})
```

`fredApiKey` is optional. If omitted, treasury indicator `series()`/`value()` calls throw: `"FRED API key required for treasury indicators"`.

The client passes config to each handle at construction time. No changes to the public consumer API — sync is fully transparent.

## File Structure

```
sdk/src/
  handles/
    ticker.ts              # unchanged
    indicator.ts           # add sync logic, freshness check, in-memory cache
    index.ts               # unchanged
  providers/
    yahoo.ts               # fetchDaily(symbol, from?)
    fred.ts                # fetchDaily(seriesId, apiKey, from?)
    index.ts               # barrel + symbol mapping helpers
  computations/
    sma.ts
    ema.ts
    rsi.ts
    returns.ts
    volatility.ts
    drawdown.ts
    calendar.ts
    index.ts               # barrel, maps indicator type to computation fn
  database.types.ts        # unchanged
  types.ts                 # unchanged (DailyBar already exported)
  client.ts                # accept fredApiKey, pass to handles
  index.ts                 # unchanged
```

New dependency: `yahoo-finance2`. FRED uses plain `fetch` (no library).

## Design Decisions

**Transparent sync over explicit:** Consumers should not need to think about data freshness. `series()` always returns complete, up-to-date data. The daily cadence of market data makes this safe — no risk of stale reads within a trading day.

**Provider + Computation inside IndicatorHandle:** The handle already knows its type and dependencies. Adding sync as internal behavior keeps the architecture flat. No need for a separate sync engine at this scale.

**Full history backfill:** Yahoo Finance provides complete history. On first call, fetch everything. On subsequent calls, only fetch missing days (incremental from latest existing date).

**Immutable data caching:** Once a trading day closes, its data never changes. The in-memory cache on the handle instance is safe to hold indefinitely within a session. Only invalidated when a new trading day closes.
