<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-05-02 -->

# src

## Purpose
v0.4 SDK source: type interfaces, the `runBacktest` runtime loop, the feature library, the tactical/v1 dialect, and reference implementations of `Calendar` / `FeatureCache` / `Executor`. Public API surface is the `index.ts` barrel.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Public API barrel — `runBacktest`, `tactical`, `features`, reference impls, type exports |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `interfaces/` | v0.4 type surface: `Strategy`, `Calendar`, `DataFeed`, `Executor`, `FeatureCache`, primitives (see `interfaces/AGENTS.md`) |
| `strategy/` | `runBacktest` runtime loop and `reconcile` helper (see `strategy/AGENTS.md`) |
| `features/` | Indicator math, `FeatureSpec` registry, `FeatureRuntime` orchestrator (see `features/AGENTS.md`) |
| `tactical/` | `tactical/v1` dialect, `fromSpec`, rule-tree evaluator, synthetic-asset wrapper (see `tactical/AGENTS.md`) |
| `calendars/` | `ExchangeCalendar` base + `NYSEExchangeCalendar` / `LSEExchangeCalendar` + holiday-rule helpers + `getCalendar` registry (see `calendars/AGENTS.md`) |
| `reference/` | `MemoryFeatureCache`, `BacktestExecutor` (see `reference/AGENTS.md`) |
| `orders/` | `Order` union and `Fill` types (see `orders/AGENTS.md`) |
| `portfolio/` | `Position`/`Portfolio` types and `applyFills`/`applyOrders` (see `portfolio/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- ESM with extensionless imports (bundler module resolution)
- Public exports go through `index.ts` — update it when adding a new public type or function
- Do not import from `@livefolio/sdk-v3` (that's the published v0.3.7, only consumed by the parity workspace); v0.4 modules are self-contained

### Architecture Flow
```
User code → tactical.fromSpec(spec, { runtime, calendar }) → Strategy<F>
  → runBacktest({ strategy, dataFeed, calendar, executor, featureCache, range, initialPortfolio })
  → BacktestResult { snapshots, finalPortfolio }
```

Per session: `strategy.universe(t)` → `strategy.features(universe, portfolio, t)` (calls `FeatureRuntime` against `DataFeed` + `FeatureCache`) → `strategy.build(features, portfolio, t)` produces `Order[]` → `Executor.submit(orders)` produces `Fill[]` → `applyFills(portfolio, fills)`.

### Testing Requirements
- Tests are co-located (`*.test.ts` next to implementation)
- Mock `DataFeed` and `Executor` with `vi.fn()` or use the in-memory reference impls
- The sdk root tsconfig excludes `**/*.test.ts` from tsc; vitest type-checks at runtime

### Common Patterns
- **Spec-driven strategies**: strategies are declarative `TacticalSpec` objects, hydrated by `tactical.fromSpec` into a runnable `Strategy<F>`
- **Pluggable runtime layers**: `DataFeed`, `Executor`, `Calendar`, `FeatureCache` are interfaces — swap independently
- **Content-addressed feature cache**: `(feature spec, asset, date)` is the cache key. `MemoryFeatureCache` is in-process; cross-process caches implement `FeatureCache`
- **Reconcile helper**: `reconcile(currentPositions, targetWeights, totalValue, prices)` produces orders that move from current to target — used by `tactical.fromSpec` internally and available for hand-written strategies

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
