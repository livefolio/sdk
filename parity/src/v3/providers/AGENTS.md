<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-04-01 -->

# providers

## Purpose
Provider interfaces and indicator-type routing. Defines `StorageProvider` (persistence) and `MarketProvider` (market data) abstractions, plus the `getProviderInfo()` mapper that routes indicator types to their data source.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel export for providers and mappings |
| `storage.ts` | `StorageProvider` interface — persistence abstraction for all database operations |
| `market.ts` | `MarketProvider` interface — market data fetching abstraction |
| `types.ts` | Shared type definitions (`IndicatorType`, `TradingFreq`, `Comparison`, `Unit`, etc.) |
| `mappings.ts` | `getProviderInfo()` — Maps indicator types to their data source and fetch parameters |

## Test Files

| File | Tests |
|------|-------|
| `mappings.test.ts` | Provider routing logic for all indicator types |

## For AI Agents

### Working In This Directory
- `StorageProvider` and `MarketProvider` are the two core abstractions consumers must implement
- Entity methods on `StorageProvider` expose both `upsert` (service_role, uses ON CONFLICT DO UPDATE) and `findOrCreate` (authenticated, SELECT-first then INSERT-if-missing) — SDK handles use `findOrCreate` by default
- `getProviderInfo()` is the routing layer — given an indicator type, it returns which provider to use
- Provider categories: `yahoo` (prices, VIX), `fred` (treasury rates), `computed` (SMA, EMA, etc. derived from Price), `calendar` (date-based), `none` (thresholds)
- `types.ts` defines all shared enums/types previously derived from the Supabase database schema

### Testing Requirements
- Mock `StorageProvider` and `MarketProvider` with `vi.fn()` in tests
- Test the mapping logic exhaustively for all indicator types

### Common Patterns
- Providers return `DailyBar[]` — uniform interface regardless of source
- Treasury tenor mapping: `T3M` → FRED series `DGS3MO`, `T10Y` → `DGS10`, etc.

## Dependencies

### Internal
- `../handles/indicator.js` — `DailyBar` type
- `./types.js` — `IndicatorType` and other shared types

### External
- None — provider interfaces have no external dependencies

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
