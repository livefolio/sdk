# Market Module

Historical series, real-time quotes, and trading calendar.

```ts
const lf = createLivefolioClient(supabase);
```

## Methods

### `getSeries(symbol): Promise<Observation[]>`

Fetch historical daily series for a symbol. Cache-through via Edge Function.

### `getBatchSeries(symbols): Promise<Record<string, Observation[]>>`

Fetch series for multiple symbols in one call.

### `getQuote(symbol): Promise<Observation>`

Get a real-time quote (Yahoo quote API with series fallback).

### `getBatchQuotes(symbols): Promise<Record<string, Observation>>`

Get quotes for multiple symbols in one call.

### `getTradingDays(startDate, endDate): Promise<TradingDay[]>`

Get trading calendar days in a date range (ISO strings).

### `getTradingDay(date): Promise<TradingDay | null>`

Get a single trading day by date.

## Types

```ts
interface Observation {
  timestamp: string; // ISO 8601
  value: number;
}
```
