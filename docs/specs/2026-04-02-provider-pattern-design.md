# Provider Pattern Refactor Design Specification

**Date:** 2026-04-02
**Status:** Draft

## Overview

Refactor `@livefolio/sdk` from a Supabase-coupled library to a pure logic SDK with pluggable storage and market data providers. The SDK defines two interfaces — `StorageProvider` and `MarketProvider` — and delegates all I/O to consumer-provided implementations. This enables open-sourcing the SDK without infrastructure dependencies, and makes auth a downstream concern of the storage provider.

## Public API

```typescript
import { createClient } from '@livefolio/sdk';

const sdk = createClient({
  storage: myStorageProvider,   // implements StorageProvider
  market: myMarketProvider,     // implements MarketProvider
});

// Same fluent API as today — no changes to handle usage
const spy = sdk.ticker('SPY');
const sma = sdk.sma(spy, 200);
const bullish = sdk.gt(sdk.price(spy), sma, 5);
const strategy = sdk.strategy({
  name: 'Tactical SPY/SHY',
  freq: 'Monthly',
  rules: [
    { when: [bullish], hold: sdk.allocation([spy, 1.0]) },
    { hold: sdk.allocation([sdk.ticker('SHY'), 1.0]) },
  ],
});
const sim = await strategy.simulate({ from: '2020-01-01', to: '2025-12-31', portfolio });
```

### Consumer Usage with Companion Packages

```typescript
import { createClient } from '@livefolio/sdk';
import { createSupabaseStorage } from '@livefolio/storage';
import { createYahooFredMarket } from '@livefolio/market';

const sdk = createClient({
  storage: createSupabaseStorage(supabaseClient),
  market: createYahooFredMarket({ fredApiKey: '...' }),
});
```

## LivefolioClientOptions

```typescript
interface LivefolioClientOptions {
  storage: StorageProvider;
  market: MarketProvider;
}

function createClient(options: LivefolioClientOptions): LivefolioClient;
```

Both providers are required. No defaults, no built-in I/O.

## MarketProvider Interface

```typescript
interface MarketProvider {
  /**
   * Fetch historical price/data bars for a symbol.
   * Symbol is pre-mapped by the SDK (e.g., T10Y → DGS10, VIX → ^VIX).
   * Provider receives the final symbol and fetches from the appropriate source.
   */
  fetchBars(symbol: string, from?: string): Promise<DailyBar[]>;
}
```

One method. The SDK owns symbol mapping (pure logic in `src/providers/mappings.ts`), translating indicator types to data source symbols before calling the provider. The provider just fetches by the symbol it receives.

## StorageProvider Interface

```typescript
interface StorageProvider {
  tickers: {
    /** Find or create a ticker. Returns existing if (symbol, leverage) already exists. */
    upsert(symbol: string, leverage: number): Promise<{ id: number }>;
  };

  indicators: {
    /** Find or create an indicator by its identity. */
    upsert(identity: IndicatorIdentity): Promise<{ id: number }>;
    /** Read cached series for an indicator, optionally filtered by date range. */
    getSeries(indicatorId: number, range?: DateRange): Promise<DailyBar[]>;
    /** Write (upsert) series bars for an indicator. */
    writeSeries(indicatorId: number, bars: DailyBar[]): Promise<void>;
    /** Get the latest date in the cached series, or null if empty. */
    getLatestSeriesDate(indicatorId: number): Promise<string | null>;
    /** Get a single indicator value, optionally for a specific date. Latest if no date. */
    getValue(indicatorId: number, date?: string): Promise<number | null>;
  };

  signals: {
    /** Find or create a signal by its identity. */
    upsert(identity: SignalIdentity): Promise<{ id: number }>;
    /** Read cached series for a signal, optionally filtered by date range. */
    getSeries(signalId: number, range?: DateRange): Promise<DailyBar[]>;
    /** Write (upsert) series bars for a signal. */
    writeSeries(signalId: number, bars: DailyBar[]): Promise<void>;
    /** Get the latest date in the cached series, or null if empty. */
    getLatestSeriesDate(signalId: number): Promise<string | null>;
    /** Get the last signal value (0 or 1), or null if empty. */
    getLastValue(signalId: number): Promise<number | null>;
  };

  allocations: {
    /** Find an existing allocation matching these holdings, or create one. */
    findOrCreate(holdings: Record<string, number>): Promise<{ id: number }>;
  };

  strategies: {
    /** Create a new strategy. Returns the created row's id. */
    create(definition: StrategyDefinition): Promise<{ id: number }>;
    /** Read the strategy series (allocation_id per trading day). */
    getSeries(strategyId: number, range?: DateRange): Promise<StrategySeriesEntry[]>;
    /** Write (upsert) strategy series entries. */
    writeSeries(strategyId: number, entries: StrategySeriesEntry[]): Promise<void>;
    /** Get the latest date in the strategy series, or null if empty. */
    getLatestSeriesDate(strategyId: number): Promise<string | null>;
    /** Resolve a strategy from a link ID, returning all data needed to reconstruct handles. */
    resolveReference(linkId: string): Promise<StrategyReferenceData>;
  };

  tradingDays: {
    /** Get trading day dates in a range. */
    getRange(range?: DateRange): Promise<string[]>;
    /** Get the most recent trading day where the market has closed. */
    getLatestClosed(): Promise<string | null>;
  };
}
```

### Supporting Types

```typescript
interface StrategySeriesEntry {
  date: string;        // YYYY-MM-DD
  allocationId: number;
}

interface StrategyDefinition {
  linkId: string;
  name: string;
  freq: TradingFreq;
  offset: number;
  rules: StrategyRuleDefinition[];
}

interface StrategyRuleDefinition {
  signalIds?: number[];
  allocationId: number;
}

interface StrategyReferenceData {
  id: number;
  name: string;
  freq: TradingFreq;
  offset: number;
  rules: {
    signals: { id: number; identity: SignalIdentity }[];
    allocations: { id: number; holdings: [TickerIdentity, number][] }[];
    definition: StrategyRuleDefinition[];
  };
}

interface TickerIdentity {
  symbol: string;
  leverage: number;
}
```

`IndicatorIdentity`, `SignalIdentity`, `DateRange`, `DailyBar`, and `TradingFreq` are existing SDK types defined in `src/handles/indicator.ts`, `src/handles/signal.ts`, and `src/handles/strategy.ts`. They remain unchanged.

### Design Principles

- **Opaque IDs:** Upserts return `{ id: number }`. The SDK threads IDs between provider calls but never inspects row contents beyond the ID.
- **No row types:** The SDK does not define database row types. The provider manages its own schema internally.
- **Domain types for complex returns:** `strategies.resolveReference()` returns `StrategyReferenceData` — a domain type the SDK can use to reconstruct handles, not a raw database row.
- **Namespaced by entity:** Methods are grouped under `storage.tickers.*`, `storage.indicators.*`, etc. for clarity.

## Symbol Mapping

The SDK retains `src/providers/mappings.ts` as pure logic. Before calling `market.fetchBars()`, the SDK maps indicator types to data source symbols:

| Indicator Type | Mapped Symbol |
|---|---|
| `Price` | Ticker symbol (e.g., `SPY`) |
| `VIX` | `^VIX` |
| `VIX3M` | `^VIX3M` |
| `T3M` | `DGS3MO` |
| `T10Y` | `DGS10` |
| ... | ... |

The `MarketProvider` receives the mapped symbol and fetches. It does not need to know about indicator types.

## What Stays in the SDK

- All handle logic (lazy resolution, caching, sync chain, computation)
- Pure computations (SMA, EMA, RSI, Return, Volatility, Drawdown)
- Signal evaluation and strategy rule matching
- Symbol mapping (`src/providers/mappings.ts`)
- Simulation engine (`runSimulation`, `SimulationHandle`, `.push()`)
- `StorageProvider` and `MarketProvider` interface definitions
- `nanoid` dependency (for strategy link IDs)
- All types and interfaces

## What Leaves the SDK

| Item | Destination |
|---|---|
| `@supabase/supabase-js` peer dependency | `@livefolio/storage` |
| `yahoo-finance2` dependency | `@livefolio/market` |
| `src/providers/yahoo.ts` | `@livefolio/market` |
| `src/providers/fred.ts` | `@livefolio/market` |
| `src/database.types.ts` | Deleted (provider manages its own types) |
| `supabase/` folder (migrations, config, seeds) | `@livefolio/storage` |

## What Changes Per Handle

| Handle | Current I/O | After Refactor |
|---|---|---|
| `TickerHandle` | `this._supabase.from('tickers').upsert(...)` | `this._storage.tickers.upsert(...)` |
| `IndicatorHandle` | Supabase queries + Yahoo/FRED via providers | `this._storage.indicators.*` + `this._market.fetchBars(...)` |
| `SignalHandle` | Supabase queries | `this._storage.signals.*` |
| `AllocationHandle` | Supabase queries | `this._storage.allocations.*` |
| `StrategyHandle` | Supabase queries | `this._storage.strategies.*` |

Handle logic (lazy resolution, caching, sync chain, computations) stays identical. Only the I/O calls change from Supabase method chains to provider method calls.

## createClient() Changes

**Before:**
```typescript
interface LivefolioClientOptions {
  supabase: TypedSupabaseClient;
  fredApiKey?: string;
}
```

**After:**
```typescript
interface LivefolioClientOptions {
  storage: StorageProvider;
  market: MarketProvider;
}
```

The `LivefolioClient` interface (returned by `createClient`) is unchanged — same `.ticker()`, `.sma()`, `.gt()`, `.strategy()`, `.allocation()`, `.portfolio()` methods. Internally, handles receive `storage` and `market` instead of `supabase`.

## Testing

Tests swap from mocking Supabase method chains (`vi.fn()` on `.from().select().eq()...`) to mocking `StorageProvider` and `MarketProvider` methods directly. This is significantly cleaner:

**Before:**
```typescript
const supabase = { from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: ... }) }) };
```

**After:**
```typescript
const storage = {
  tickers: { upsert: vi.fn().mockResolvedValue({ id: 1 }) },
  indicators: { getSeries: vi.fn().mockResolvedValue([...]) },
  // ...
};
```

## Companion Packages

### `@livefolio/storage`

Implements `StorageProvider` for Supabase. Ships with:
- `createSupabaseStorage(supabaseClient): StorageProvider`
- Supabase migrations for all SDK tables
- RLS policies using `auth.uid()` for user-scoped tables
- Handles pagination, joins, and conflict resolution internally

### `@livefolio/market`

Implements `MarketProvider` for Yahoo Finance + FRED. Ships with:
- `createYahooFredMarket(options: { fredApiKey: string }): MarketProvider`
- Wraps `yahoo-finance2` for equity/VIX data
- Wraps FRED API for treasury data
- Routes by symbol pattern internally

### Auth Story

Auth is not the SDK's concern. The `@livefolio/storage` Supabase adapter:
- Receives an authenticated Supabase client from the consumer app
- RLS policies on SDK tables use `auth.uid()` to scope data per user
- User-ownable tables (strategies, allocations, signals) get `user_id` columns in the migrations
- Shared data (tickers, trading_days, indicators) stays public-read

## Package Dependency Graph

```
@livefolio/sdk (open source, zero I/O deps)
├── Defines: StorageProvider, MarketProvider interfaces
├── Depends on: nanoid
└── Peer deps: none

@livefolio/storage (open source)
├── Implements: StorageProvider
├── Depends on: @supabase/supabase-js
└── Ships: migrations, RLS policies

@livefolio/market (open source)
├── Implements: MarketProvider
├── Depends on: yahoo-finance2
└── No database dependency

Consumer App
├── Depends on: @livefolio/sdk, @livefolio/storage, @livefolio/market
├── Owns: Supabase project, auth flows
└── Passes providers to createClient()
```

## Design Decisions

1. **Both providers required, no defaults** — The SDK does zero I/O. Consumers explicitly choose their storage and market data backends.
2. **SDK owns symbol mapping** — Pure logic that translates indicator types to data source symbols. The market provider just fetches by symbol.
3. **Opaque IDs, no row types** — The SDK doesn't define database schemas. Upserts return `{ id: number }`, the provider manages its own schema.
4. **Namespaced provider methods** — `storage.tickers.upsert()` over `storage.upsertTicker()` for clarity and discoverability.
5. **Domain types for complex returns** — `resolveReference()` returns a domain type, not raw rows. The provider translates its schema to the SDK's expected shape.
6. **Auth is the storage provider's concern** — The SDK is auth-unaware. The Supabase storage adapter handles RLS and user scoping via the authenticated client.
7. **Companion packages are separate repos** — `@livefolio/storage` and `@livefolio/market` are independently versioned and publishable. The SDK has no dependency on either.

## File Structure After Refactor

### Removed
- `src/database.types.ts`
- `src/providers/yahoo.ts`
- `src/providers/fred.ts`
- `src/types.ts` (TypedSupabaseClient)
- `supabase/` folder

### New
- `src/providers/storage.ts` — `StorageProvider` interface definition
- `src/providers/market.ts` — `MarketProvider` interface definition
- `src/providers/types.ts` — Supporting types (StrategyReferenceData, StrategySeriesEntry, etc.)

### Modified
- `src/client.ts` — Accept `StorageProvider` + `MarketProvider` instead of Supabase client
- `src/handles/ticker.ts` — Use `storage.tickers.*`
- `src/handles/indicator.ts` — Use `storage.indicators.*` + `market.fetchBars()`
- `src/handles/signal.ts` — Use `storage.signals.*`
- `src/handles/allocation.ts` — Use `storage.allocations.*`
- `src/handles/strategy.ts` — Use `storage.strategies.*`
- `src/index.ts` — Export new interfaces, remove Supabase types
- `src/providers/mappings.ts` — Stays (pure logic), remove provider routing
- All test files — Mock provider interfaces instead of Supabase

### Unchanged
- `src/backtest/simulate.ts` — Already pure
- `src/backtest/types.ts` — No I/O
- `src/computations/` — All pure functions
- `src/handles/portfolio.ts` — No I/O
