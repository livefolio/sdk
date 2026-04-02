<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-04-01 -->

# src

## Purpose
All TypeScript source code for the SDK. Organized into handle classes (lazy abstractions backed by a `StorageProvider`), computation functions (technical indicators), provider interfaces (storage and market data), and a backtesting engine.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Public API barrel export — all handles, types, and `createClient` |
| `client.ts` | `createClient()` factory and `LivefolioClient` interface definition |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `handles/` | Lazy database-backed handle classes (see `handles/AGENTS.md`) |
| `computations/` | Pure computation functions for technical indicators (see `computations/AGENTS.md`) |
| `providers/` | Provider interfaces and mappings (see `providers/AGENTS.md`) |
| `backtest/` | Portfolio simulation engine (see `backtest/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- All imports use `.js` extensions (ESM with nodenext resolution)
- Public exports go through `index.ts` — update it when adding new public types or classes
- `client.ts` is the user-facing API surface — it wires handles together via factory methods
- All database interaction goes through `StorageProvider`; market data through `MarketProvider`

### Architecture Flow
```
User code → createClient() → LivefolioClient methods
  → TickerHandle / IndicatorHandle / SignalHandle (lazy, resolve on demand)
  → AllocationHandle (weighted holdings)
  → StrategyHandle (rule engine: signals → allocations)
  → StrategyHandle.simulate() → runSimulation() → SimulationHandle
```

### Testing Requirements
- Tests are co-located (`*.test.ts` next to implementation)
- Run `npm test` from project root
- Mock `StorageProvider` and `MarketProvider` with `vi.fn()` — no live database needed

### Common Patterns
- **Lazy resolution**: Handles store identity params in constructor, defer DB upsert to `.resolve()`
- **`fromResolved()` static**: Every handle has a `fromResolved()` to reconstruct from known IDs without re-resolving
- **Provider abstraction**: `StorageProvider` handles all persistence; `MarketProvider` handles all market data fetching

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
