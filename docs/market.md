# Market Module

Retrieves market data (historical series, live quotes, trading calendar) via Supabase Edge Functions and direct queries.

## Methods

### `getSeries(symbol)`

Fetches the full historical daily series for a single symbol.

| Parameter | Type     | Description           |
|-----------|----------|-----------------------|
| `symbol`  | `string` | Ticker symbol (e.g. `"SPY"`, `"^VIX"`, `"DGS10"`) |

**Returns** `Promise<Observation[]>` — array sorted by date ascending.

```ts
const series = await livefolio.market.getSeries('SPY');
// [{ timestamp: '2025-01-06T21:00:00.000Z', value: 590.5 }, ...]
```

> Delegates to `getBatchSeries` internally.

---

### `getBatchSeries(symbols)`

Fetches historical daily series for multiple symbols in a single request.

| Parameter | Type       | Description              |
|-----------|------------|--------------------------|
| `symbols` | `string[]` | Array of ticker symbols  |

**Returns** `Promise<Record<string, Observation[]>>` — keyed by symbol.

```ts
const series = await livefolio.market.getBatchSeries(['SPY', 'BND']);
// { SPY: [...], BND: [...] }
```

**Transport:** Invokes the `series` Edge Function with `{ symbols }` body. The edge function uses cache-through: checks the `daily_observations` table first, fetches from upstream on miss.

**Throws** on invocation error.

---

### `getQuote(symbol)`

Fetches the latest quote for a single symbol.

| Parameter | Type     | Description          |
|-----------|----------|----------------------|
| `symbol`  | `string` | Ticker symbol        |

**Returns** `Promise<Observation>` — single observation with latest price.

```ts
const quote = await livefolio.market.getQuote('SPY');
// { timestamp: '2025-03-04T20:00:00.000Z', value: 592.3 }
```

**Throws** `Error('No quote available for ${symbol}')` if the symbol is not found in the response.

> Delegates to `getBatchQuotes` internally.

---

### `getBatchQuotes(symbols)`

Fetches latest quotes for multiple symbols in a single request.

| Parameter | Type       | Description              |
|-----------|------------|--------------------------|
| `symbols` | `string[]` | Array of ticker symbols  |

**Returns** `Promise<Record<string, Observation>>` — keyed by symbol.

```ts
const quotes = await livefolio.market.getBatchQuotes(['SPY', 'BND', 'GLD']);
// { SPY: { timestamp: '...', value: 592.3 }, BND: {...}, GLD: {...} }
```

**Transport:** Invokes the `quote` Edge Function. Tries Yahoo quote data first, falls back to latest series observation.

**Throws** on invocation error.

---

### `getTradingDays(startDate, endDate)`

Fetches NYSE trading days within a date range.

| Parameter   | Type     | Description                    |
|-------------|----------|--------------------------------|
| `startDate` | `string` | Start date (`YYYY-MM-DD`)      |
| `endDate`   | `string` | End date (`YYYY-MM-DD`)        |

**Returns** `Promise<TradingDay[]>` — ascending-sorted array.

```ts
const days = await livefolio.market.getTradingDays('2025-01-06', '2025-01-10');
// [{ date: '2025-01-06', open: '...', close: '...', extended_open: '...', extended_close: '...' }, ...]
```

**Transport:** Direct Supabase query on `trading_days` table.

**Throws** with message on query error.

---

### `getTradingDay(date)`

Fetches a single trading day by date.

| Parameter | Type     | Description               |
|-----------|----------|---------------------------|
| `date`    | `string` | Date (`YYYY-MM-DD`)       |

**Returns** `Promise<TradingDay | null>` — `null` if the date is not a trading day (weekend, holiday) or on error.

```ts
const day = await livefolio.market.getTradingDay('2025-01-06');
// { date: '2025-01-06', open: '2025-01-06T14:30:00Z', close: '2025-01-06T21:00:00Z', ... }
```

## Types

### `Observation`

```ts
interface Observation {
  timestamp: string;  // ISO 8601
  value: number;
}
```

The `timestamp` corresponds to `trading_days.post` (market close) for series data, or Yahoo's `regularMarketTime` for quotes.

### `TradingDay`

```ts
interface TradingDay {
  date: string;           // YYYY-MM-DD
  open: string;           // ISO 8601 — regular market open
  close: string;          // ISO 8601 — regular market close (post)
  extended_open: string;  // ISO 8601 — overnight/pre-market open
  extended_close: string; // ISO 8601 — extended hours close
}
```

> DB column mapping: `regular` -> `open`, `post` -> `close`, `overnight` -> `extended_open`, `close` -> `extended_close`.
