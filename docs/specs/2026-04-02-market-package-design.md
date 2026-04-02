# @livefolio/market Design Specification

**Date:** 2026-04-02
**Status:** Draft

## Overview

Standalone package (`@livefolio/market`) that implements the SDK's `MarketProvider` interface. Fetches historical market data from Yahoo Finance and FRED, routing by symbol convention. No caching, no rate limiting — purely a fetch layer.

## Public API

```typescript
import { createYahooFredMarket } from '@livefolio/market';
import type { MarketProvider } from '@livefolio/sdk';

const market: MarketProvider = createYahooFredMarket({
  fredApiKey: 'your-fred-api-key', // required
});

const bars = await market.fetchBars('SPY');               // Yahoo
const bars = await market.fetchBars('SPY', '2025-01-01'); // Yahoo, incremental
const bars = await market.fetchBars('^VIX');               // Yahoo
const bars = await market.fetchBars('DGS10');              // FRED
```

Single export, single factory, one required option. Returns a `MarketProvider`.

### Options

```typescript
interface YahooFredMarketOptions {
  fredApiKey: string; // required, throws if missing
}
```

## Symbol Routing

Convention-based routing using an explicit allowlist of FRED series IDs. Everything else routes to Yahoo.

```typescript
type DataSource = 'yahoo' | 'fred';

const FRED_SERIES = new Set([
  // Treasury constant maturity rates
  'DGS3MO', 'DGS6MO', 'DGS1', 'DGS2', 'DGS3',
  'DGS5', 'DGS7', 'DGS10', 'DGS20', 'DGS30',
  // Treasury bill rates
  'DTB3', 'DTB6',
]);

function routeSymbol(symbol: string): DataSource {
  if (FRED_SERIES.has(symbol)) return 'fred';
  return 'yahoo';
}
```

When a new FRED series is added to the SDK's mappings, the allowlist gets updated here.

## Yahoo Finance Fetcher

```typescript
import yahooFinance from 'yahoo-finance2';
import type { DailyBar } from '@livefolio/sdk';
import { MarketFetchError } from './errors';

export async function fetchYahooBars(
  symbol: string,
  from?: string,
): Promise<DailyBar[]> {
  try {
    const result = await yahooFinance.chart(symbol, {
      ...(from && { period1: from }),
      interval: '1d',
    });

    return result.quotes.map((q) => ({
      date: q.date.toISOString().slice(0, 10),
      value: q.close,
    }));
  } catch (err) {
    throw new MarketFetchError('yahoo', symbol, err);
  }
}
```

- Uses `close` price (not adjusted)
- No default start/end dates — fetches all available history when `from` is omitted
- `from` passed as `period1` when present

## FRED Fetcher

```typescript
import type { DailyBar } from '@livefolio/sdk';
import { MarketFetchError } from './errors';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

export async function fetchFredBars(
  seriesId: string,
  apiKey: string,
  from?: string,
): Promise<DailyBar[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    ...(from && { observation_start: from }),
  });

  try {
    const res = await fetch(`${FRED_BASE}?${params}`);
    if (!res.ok) {
      throw new Error(`FRED API returned ${res.status}`);
    }

    const data = await res.json();

    return data.observations
      .filter((o: { value: string }) => o.value !== '.')
      .map((o: { date: string; value: string }) => ({
        date: o.date,
        value: parseFloat(o.value),
      }));
  } catch (err) {
    throw new MarketFetchError('fred', seriesId, err);
  }
}
```

- Uses native `fetch` — no extra HTTP dependency
- FRED returns `"."` for missing values (holidays, etc.) — these are filtered out
- `from` passed as `observation_start` when present

## Error Handling

```typescript
export class MarketFetchError extends Error {
  constructor(
    public readonly source: 'yahoo' | 'fred',
    public readonly symbol: string,
    public readonly cause: unknown,
  ) {
    super(
      `Failed to fetch ${symbol} from ${source}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'MarketFetchError';
  }
}
```

Typed errors with source and symbol context. Errors propagate to the consumer — no retries, no fallbacks.

## Package Structure

```
market/
  src/
    index.ts          # createYahooFredMarket factory, re-exports MarketFetchError
    router.ts         # routeSymbol + FRED_SERIES set
    yahoo.ts          # fetchYahooBars
    fred.ts           # fetchFredBars
    errors.ts         # MarketFetchError class
  package.json
  tsconfig.json
  vitest.config.ts
  eslint.config.js
  .prettierrc
```

## Dependencies

| Dependency | Type | Purpose |
|---|---|---|
| `@livefolio/sdk` | peer | `MarketProvider` and `DailyBar` types |
| `yahoo-finance2` | runtime | Yahoo Finance data fetching |
| `tsup` | dev | Bundler (ESM output, dts generation) |
| `vitest` | dev | Test runner |
| `typescript` | dev | Compiler |
| `eslint` + `typescript-eslint` | dev | Linting |
| `prettier` | dev | Formatting |

No other runtime dependencies. FRED uses native `fetch`.

## Tooling Conventions

Mirrors the SDK:
- ESM (`"type": "module"`, extensionless imports)
- Build: `tsup` bundles to `dist/` (handles ESM output, dts generation)
- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- Co-located `*.test.ts` files
- Prettier + ESLint with typescript-eslint

## Testing

Unit tests with mocked externals, no real API calls:

- **`router.test.ts`** — `routeSymbol` returns `'fred'` for all FRED series, `'yahoo'` for everything else (`SPY`, `^VIX`, `AAPL`, etc.)
- **`yahoo.test.ts`** — mock `yahoo-finance2`, verify `DailyBar[]` mapping, verify `MarketFetchError` on failure, verify `from` is passed as `period1`
- **`fred.test.ts`** — mock `fetch`, verify `DailyBar[]` parsing, verify `"."` values filtered out, verify `MarketFetchError` on non-OK response, verify `from` is passed as `observation_start`
- **`index.test.ts`** — integration: `createYahooFredMarket` routes Yahoo symbols to Yahoo fetcher, FRED symbols to FRED fetcher

## Design Decisions

1. **Single unified provider** — one factory, internal routing. No composable provider abstraction (YAGNI).
2. **Convention-based routing with allowlist** — explicit FRED series set, everything else Yahoo. No regex guessing.
3. **Required FRED API key** — throws at construction if missing. Both data sources are expected.
4. **Pure fetch layer** — no caching (SDK's StorageProvider handles it), no rate limiting (call frequency is low).
5. **Typed errors, not resilient** — `MarketFetchError` with source context. Errors propagate, no retries.
6. **`close` price, not adjusted** — raw close values from Yahoo.
7. **No default date ranges** — omit dates to fetch all available history, pass `from` for incremental.
8. **Standalone repo** — independent git history, versioning, and publishing. No monorepo coupling.
