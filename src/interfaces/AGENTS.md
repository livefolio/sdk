<!-- Parent: ../AGENTS.md -->

# src/interfaces

## Purpose
The v0.4 type surface. Pure type-only declarations — no runtime code. Defines the contracts that runtime layers (data feeds, executors, calendars, feature caches) and strategies satisfy. Every concrete impl in `src/reference/` implements an interface declared here.

## Key Files

| File | Description |
|------|-------------|
| `types.ts` | Primitive types: `Asset`, `AssetId`, `Bar`, `DateRange`, `Frequency`, `Series` |
| `data-feed.ts` | `DataFeed` interface (`bars(asset, range, freq) → AsyncIterable<Bar>`); also `Fundamentals`, `EventKind`, `DataEvent` for richer feeds |
| `executor.ts` | `Executor` interface (`submit(orders, t, portfolio) → Fill[]`) |
| `calendar.ts` | `Calendar` interface (`isOpen`, `next`, `previous`, `sessions`) |
| `feature-cache.ts` | `FeatureCache` interface plus `FeatureKey`, `FeatureScope` |
| `index.ts` | Barrel — re-exports all type symbols |

## For AI Agents

### Working In This Directory
- Type-only — no runtime imports allowed. Every file should compile to nothing
- This is the contract layer: changes here ripple through `src/strategy/`, `src/features/`, `src/reference/`, and downstream packages (`@livefolio/datafeed-yfinance`)
- New interface? Add it here, export from `index.ts`, then implement in `src/reference/` (or a downstream package)
- Tests: there aren't any — these are pure types. Conformance is verified by the implementations passing their own tests

### Common Patterns
- Interfaces use `readonly` aggressively; mutability is opt-in
- `AsyncIterable` for `DataFeed.bars` (streamable, lazy)
- `Frequency = '1m' | '5m' | '15m' | '1h' | '1d'` — most strategies use `'1d'`; subdaily values exist in the type but reference impls today only handle daily
