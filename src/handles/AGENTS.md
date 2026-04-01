<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-04-01 -->

# handles

## Purpose
Lazy, database-backed handle classes that form the core abstraction layer. Each handle represents an entity (ticker, indicator, signal, allocation, strategy, portfolio) that can be composed declaratively and resolved to database rows on demand.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel export for all handles and their public types |
| `ticker.ts` | `TickerHandle` — wraps a (symbol, leverage) pair, upserts to `tickers` table |
| `indicator.ts` | `IndicatorHandle` — technical indicator definition + time-series sync from providers |
| `signal.ts` | `SignalHandle` — comparison between two indicators (gt/lt/eq), produces boolean series |
| `allocation.ts` | `AllocationHandle` — weighted portfolio holdings, upserts to `allocations` table |
| `strategy.ts` | `StrategyHandle` — rule engine mapping signals to allocations, with simulation support |
| `portfolio.ts` | `PortfolioHandle` — concrete position quantities (shares, not weights), computes trades to rebalance |

## Test Files

| File | Tests |
|------|-------|
| `ticker.test.ts` | Ticker resolution and upsert behavior |
| `indicator.test.ts` | Indicator identity, series sync, and caching |
| `signal.test.ts` | Signal resolution and boolean series computation |
| `allocation.test.ts` | Allocation normalization and persistence |
| `strategy.test.ts` | Strategy creation, reference loading, and series evaluation |
| `strategy-simulate.test.ts` | End-to-end simulation through StrategyHandle |
| `portfolio.test.ts` | Portfolio value, weights, and trade generation |
| `sync.test.ts` | Indicator sync pipeline integration tests |
| `fromRow.test.ts` | `fromRow()` static reconstruction for all handles |

## For AI Agents

### Working In This Directory
- Every handle follows the same pattern: constructor stores identity → `.resolve()` upserts to DB → `.id` accessor throws if unresolved
- `fromRow()` static methods reconstruct handles from database rows without re-resolving
- `IndicatorHandle` is the most complex — it orchestrates data fetching from providers and computation
- `StrategyHandle` has two construction modes: create-new (with rules) and load-by-link-id
- `PortfolioHandle` is the only handle that does NOT persist to the database — it's a runtime value object

### Handle Dependency Chain
```
TickerHandle
  └─ IndicatorHandle (references ticker for price-based indicators)
       └─ SignalHandle (compares two indicators)
            └─ StrategyHandle (maps signals → allocations)
AllocationHandle (weighted holdings — used by strategy rules)
PortfolioHandle (concrete share quantities — used by simulation)
```

### Testing Requirements
- Tests mock Supabase with `vi.fn()` returning `{ data, error }` shapes
- Test the resolve → id → series flow for each handle
- `strategy-simulate.test.ts` tests the full pipeline end-to-end

### Common Patterns
- **Lazy singleton resolve**: `_resolved` caches the row, `_resolving` deduplicates concurrent calls
- **Paginated series queries**: All `.series()` methods loop with 1000-row pages
- **CASHX special case**: The cash ticker (`CASHX`) has a fixed price of 1 and is excluded from price lookups

## Dependencies

### Internal
- `../types.js` — `TypedSupabaseClient`
- `../database.types.js` — Table/enum types
- `../computations/` — Pure indicator computation functions
- `../providers/` — Yahoo Finance and FRED data fetchers
- `../backtest/` — Simulation engine (used by `StrategyHandle.simulate()`)

### External
- `nanoid` — Strategy link ID generation (in `strategy.ts`)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
