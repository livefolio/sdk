<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-04-01 -->

# providers

## Purpose
External data source adapters that fetch raw time-series data. Each provider returns `DailyBar[]` arrays consumed by `IndicatorHandle` during sync.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel export for providers and mappings |
| `yahoo.ts` | `fetchYahoo()` — Fetches historical price data from Yahoo Finance via `yahoo-finance2` |
| `fred.ts` | `fetchFred()` — Fetches economic data (treasury rates) from FRED API |
| `mappings.ts` | `getProviderInfo()` — Maps indicator types to their data source and fetch parameters |

## Test Files

| File | Tests |
|------|-------|
| `yahoo.test.ts` | Yahoo Finance fetch behavior and data transformation |
| `fred.test.ts` | FRED API fetch behavior |
| `mappings.test.ts` | Provider routing logic for all indicator types |

## For AI Agents

### Working In This Directory
- `getProviderInfo()` is the routing layer — given an indicator type, it returns which provider to use
- Provider categories: `yahoo` (prices, VIX), `fred` (treasury rates), `computed` (SMA, EMA, etc. derived from Price), `calendar` (date-based), `none` (thresholds)
- FRED requires an API key passed via `LivefolioClientOptions.fredApiKey`
- Yahoo Finance uses the `yahoo-finance2` npm package

### Testing Requirements
- Mock external HTTP calls in tests — never hit real APIs
- Test the mapping logic exhaustively for all indicator types

### Common Patterns
- Providers return `DailyBar[]` — uniform interface regardless of source
- Treasury tenor mapping: `T3M` → FRED series `DGS3MO`, `T10Y` → `DGS10`, etc.

## Dependencies

### Internal
- `../handles/indicator.js` — `DailyBar` type
- `../database.types.js` — `indicator_type` enum

### External
- `yahoo-finance2` — Yahoo Finance data API
- FRED API (HTTP) — Federal Reserve Economic Data

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
