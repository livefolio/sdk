# @livefolio/storage Package Design Specification

**Date:** 2026-04-02
**Status:** Draft

## Overview

`@livefolio/storage@0.0.1` is a Supabase implementation of the SDK's `StorageProvider` interface. It lives at `livefolio-2/storage/` as a sibling package to `sdk/`, `cli/`, and `app/`. It owns the database schema (migrations + seed data) and translates the SDK's domain-oriented storage calls into Supabase PostgREST queries.

## Public API

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StorageProvider } from '@livefolio/sdk';

export function createSupabaseStorage(supabase: SupabaseClient): StorageProvider;
export type { Database } from './database.types';
```

Exports the `createSupabaseStorage` factory and the auto-generated `Database` type (from `supabase gen types`). Consumers can use `Database` to type their own Supabase client: `createClient<Database>(url, key)`.

### Consumer Usage

```typescript
import { createClient } from '@livefolio/sdk';
import { createSupabaseStorage } from '@livefolio/storage';
import { createYahooFredMarket } from '@livefolio/market';

const sdk = createClient({
  storage: createSupabaseStorage(supabaseClient),
  market: createYahooFredMarket({ fredApiKey: '...' }),
});
```

## Package Identity

```json
{
  "name": "@livefolio/storage",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "engines": { "node": ">=20" },
  "peerDependencies": {
    "@livefolio/sdk": "^0.0.1",
    "@supabase/supabase-js": "^2"
  }
}
```

No runtime dependencies. Both the SDK (for type imports) and Supabase client are peer dependencies. Bundled with `tsup`. Source uses extensionless imports (tsup resolves them at build time).

## File Structure

```
storage/
├── src/
│   ├── index.ts              # createSupabaseStorage() factory, barrel export
│   ├── database.types.ts     # Auto-generated Supabase types (supabase gen types), exported
│   ├── tickers.ts            # storage.tickers.* implementation
│   ├── indicators.ts         # storage.indicators.* implementation
│   ├── signals.ts            # storage.signals.* implementation
│   ├── allocations.ts        # storage.allocations.* implementation
│   ├── strategies.ts         # storage.strategies.* implementation
│   ├── trading-days.ts       # storage.tradingDays.* implementation
│   ├── trading-day-ids.ts    # Shared date-to-trading_day_id resolver
│   ├── tickers.test.ts
│   ├── indicators.test.ts
│   ├── signals.test.ts
│   ├── allocations.test.ts
│   ├── strategies.test.ts
│   ├── trading-days.test.ts
│   └── trading-day-ids.test.ts
├── supabase/
│   ├── config.toml           # Local dev config (not shipped)
│   ├── migrations/           # All 11 migrations (moved from sdk/supabase/)
│   └── seed.sql              # Trading days seed data
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── eslint.config.js
├── .prettierrc
└── vitest.config.ts
```

## Internal Architecture

### Factory Pattern

The factory composes one object per `StorageProvider` namespace:

```typescript
// storage/src/index.ts
export function createSupabaseStorage(supabase: SupabaseClient): StorageProvider {
  return {
    tickers: createTickers(supabase),
    indicators: createIndicators(supabase),
    signals: createSignals(supabase),
    allocations: createAllocations(supabase),
    strategies: createStrategies(supabase),
    tradingDays: createTradingDays(supabase),
  };
}
```

### Namespace Modules

Each module exports a single factory returning its sub-interface:

```typescript
// storage/src/tickers.ts
export function createTickers(supabase: SupabaseClient): StorageProvider['tickers'] {
  return {
    async upsert(symbol, leverage) {
      const { data, error } = await supabase
        .from('tickers')
        .upsert({ symbol, leverage }, { onConflict: 'symbol,leverage' })
        .select('id')
        .single();
      if (error) throw new Error(`tickers.upsert: ${error.message}`);
      return { id: data.id };
    },
  };
}
```

Each module is self-contained except for the shared `resolveTradingDayIds` helper.

### File-to-Namespace Mapping

| File | Namespace | Methods |
|------|-----------|---------|
| `tickers.ts` | `storage.tickers` | `upsert` |
| `indicators.ts` | `storage.indicators` | `upsert`, `getSeries`, `writeSeries`, `getLatestSeriesDate`, `getValue` |
| `signals.ts` | `storage.signals` | `upsert`, `getSeries`, `writeSeries`, `getLatestSeriesDate`, `getLastValue` |
| `allocations.ts` | `storage.allocations` | `findOrCreate` (JSONB equality match via `@>` + `<@` containment) |
| `strategies.ts` | `storage.strategies` | `create`, `getSeries`, `writeSeries`, `getLatestSeriesDate`, `resolveReference` |
| `trading-days.ts` | `storage.tradingDays` | `getRange`, `getLatestClosed` |

## The Trading Day ID Join

The SDK's `StorageProvider` interface speaks in dates (`YYYY-MM-DD` strings). The Supabase schema stores series data joined through `trading_days.id`. The storage package bridges this.

### Reads (getSeries, getLatestSeriesDate, getValue, getLastValue)

Use PostgREST joins to resolve dates inline:

```typescript
// indicators.getSeries example
const { data } = await supabase
  .from('indicators_series')
  .select('value, trading_days(date)')
  .eq('indicator_id', indicatorId)
  .gte('trading_days.date', range?.from)
  .lte('trading_days.date', range?.to)
  .order('trading_days(date)');
// Transform to DailyBar[] → { date, value }
```

### Writes (writeSeries)

Incoming `DailyBar[]` has `{ date, value }` with no `trading_day_id`. A shared helper resolves dates to IDs using a date range (min/max) instead of individual date filtering, avoiding PostgREST URL-too-long errors:

```typescript
// storage/src/trading-day-ids.ts
export async function resolveTradingDayIds(
  supabase: SupabaseClient,
  dates: string[],
): Promise<Map<string, number>> {
  const min = dates.reduce((a, b) => (a < b ? a : b));
  const max = dates.reduce((a, b) => (a > b ? a : b));
  const { data, error } = await supabase
    .from('trading_days')
    .select('id, date')
    .gte('date', min)
    .lte('date', max);
  if (error) throw new Error(`resolveTradingDayIds: ${error.message}`);
  return new Map(data.map((row) => [row.date, row.id]));
}
```

Series dates are contiguous within a range, so fetching by min/max is equivalent to filtering individual dates and safe from URL length limits.

Write methods call this once, then map bars to `{ indicator_id, trading_day_id, value }` before upserting. One extra query per write — acceptable since writes are bulk sync operations.

## PostgREST Constraints

Two Supabase/PostgREST constraints that affect the implementation:

1. **URL length limits** — PostgREST encodes filters in the URL. Large `.in()` filters (hundreds of values) can exceed URL limits. Use range queries (`.gte()` / `.lte()`) instead of `.in()` for date filtering. The `resolveTradingDayIds` helper above follows this pattern.

2. **Default pagination (1000 rows)** — Supabase returns at most 1000 rows per request by default. Series queries for long date ranges can exceed this. All `getSeries` and `getRange` calls must set `.range(0, count)` or paginate to ensure complete results. The approach: first get the count, then fetch with an explicit range, or paginate in chunks of 1000.

## strategies.resolveReference

The most complex method. Given a `linkId`, returns the full strategy graph as `StrategyReferenceData`.

### Query Plan

1. Fetch strategy row by `link_id`
2. Parse `definition` JSONB to extract `signalIds[]` and `allocationIds[]`
3. Parallel: fetch signals by IDs, fetch allocations by IDs
4. Collect `indicator_id_1` + `indicator_id_2` from signals, fetch indicators by IDs
5. Collect `ticker_id`s from indicators, fetch tickers by IDs
6. Assemble `StrategyReferenceData`

~4 sequential round trips, each with small `IN` queries. No Supabase views or RPC needed. A strategy typically has 2-10 signals, so result sets are small.

## Error Handling

Every Supabase response is checked for `.error`. Errors are thrown as standard `Error` with a prefix indicating the method:

```typescript
if (error) throw new Error(`indicators.upsert: ${error.message}`);
```

The SDK doesn't know about Supabase error shapes. The storage package normalizes them.

## Schema Ownership

### Migrations

All 11 existing migrations move from `sdk/supabase/migrations/` to `storage/supabase/migrations/`:

- `20260330173259_create_trading_days_table.sql`
- `20260330180001_create_tickers_table.sql`
- `20260330180058_create_indicators_table.sql`
- `20260330180515_create_indicators_series_table.sql`
- `20260330180631_create_signals_table.sql`
- `20260330181257_create_signals_series_table.sql`
- `20260330193341_enable_rls_public_read.sql`
- `20260330202452_add_created_at_to_tickers_indicators_signals.sql`
- `20260330214745_create_allocations_table.sql`
- `20260330214814_create_strategies_table.sql`
- `20260330224412_create_strategies_series_table.sql`

New migrations are added to this package going forward.

### Seed Data

`storage/supabase/seed.sql` contains the manually-curated NYSE trading day calendar. Shipped in the npm package so consumers can seed their own Supabase project.

### What Ships in npm

- `dist/` — bundled JS + `.d.ts` type declarations (built by `tsup`)

Supabase migrations, seed, and config are part of the repo but not included in the npm package.

## Testing

Unit tests mock `SupabaseClient` and verify query construction + response transformation.

```typescript
// Example: tickers.test.ts
const supabase = {
  from: vi.fn().mockReturnValue({
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
      }),
    }),
  }),
};

const tickers = createTickers(supabase as unknown as SupabaseClient);
const result = await tickers.upsert('SPY', 1);
expect(result).toEqual({ id: 1 });
expect(supabase.from).toHaveBeenCalledWith('tickers');
```

### Test Files

| Test File | Covers |
|-----------|--------|
| `tickers.test.ts` | upsert, conflict handling |
| `indicators.test.ts` | upsert, getSeries with date joins, writeSeries with trading day resolution, getLatestSeriesDate, getValue |
| `signals.test.ts` | upsert, getSeries, writeSeries, getLatestSeriesDate, getLastValue |
| `allocations.test.ts` | findOrCreate, JSONB matching |
| `strategies.test.ts` | create, getSeries, writeSeries, getLatestSeriesDate, resolveReference fan-out |
| `trading-days.test.ts` | getRange with date filtering, getLatestClosed |
| `trading-day-ids.test.ts` | Shared date-to-id resolution helper |

No integration tests with a real Supabase instance — that's the consumer app's concern.

### Tooling

Vitest, tsup (bundler), ESLint + typescript-eslint, Prettier, Husky + lint-staged.

## Design Decisions

1. **Flat modules over classes** — ~20 async functions don't need class machinery. One file per namespace, plain function factories.
2. **Peer dependencies only** — `@livefolio/sdk` for types, `@supabase/supabase-js` for the client. No runtime deps.
3. **Accept pre-built SupabaseClient** — Consumer owns client creation and auth. Storage is just an adapter.
4. **Storage owns the schema** — Migrations and seed live in this package. Consumers apply them to their Supabase project.
5. **Bundled with tsup** — Extensionless imports in source, tsup resolves at build time. Only `dist/` ships in npm.
6. **PostgREST joins for reads** — Avoid extra round trips by joining `trading_days` inline in select queries.
7. **Shared trading-day-id helper for writes** — Single reusable function for the date-to-id resolution needed by all write methods.
8. **Errors as standard Error** — Normalize Supabase errors at the boundary. The SDK sees plain `Error` objects.
