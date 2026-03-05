# Market Module

Historical series, real-time quotes, and trading calendar.

```ts
const lf = createLivefolioClient(supabase);
```

## Methods

### `getSeries(symbol): Promise<Observation[]>`

Fetch historical daily series for a symbol. Cache-through via Edge Function.

```ts
const series = await lf.market.getSeries('SPY');
console.log(series[0]); // { timestamp: '2025-01-10T16:00:00Z', value: 590.25 }
```

### `getBatchSeries(symbols): Promise<Record<string, Observation[]>>`

Fetch series for multiple symbols in one call.

```ts
const batch = await lf.market.getBatchSeries(['SPY', 'QQQ', 'TLT']);
// → { SPY: [{ timestamp: '2025-01-10T...', value: 590.25 }, ...], QQQ: [...], TLT: [...] }
```

### `getQuote(symbol): Promise<Observation>`

Get a real-time quote (Yahoo quote API with series fallback).

```ts
const quote = await lf.market.getQuote('SPY');
console.log(quote); // { timestamp: '2025-06-01T20:00:00Z', value: 592.10 }
```

### `getBatchQuotes(symbols): Promise<Record<string, Observation>>`

Get quotes for multiple symbols in one call.

```ts
const quotes = await lf.market.getBatchQuotes(['SPY', 'QQQ']);
// → { SPY: { timestamp: '...', value: 592.10 }, QQQ: { timestamp: '...', value: 480.50 } }
```

### `getTradingDays(startDate, endDate): Promise<TradingDay[]>`

Get trading calendar days in a date range (ISO strings).

```ts
const days = await lf.market.getTradingDays('2025-01-01', '2025-01-31');
// → [{ date: '2025-01-02', open: '...T14:30:00Z', close: '...T21:00:00Z', ... }, ...]
```

### `getTradingDay(date): Promise<TradingDay | null>`

Get a single trading day by date.

```ts
const day = await lf.market.getTradingDay('2025-06-02');
// → { date: '2025-06-02', open: '2025-06-02T14:30:00Z', close: '2025-06-02T21:00:00Z', ... }
```

## Types

```ts
interface Observation {
  timestamp: string; // ISO 8601
  value: number;
}
```
