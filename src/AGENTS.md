<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-05-02 -->

# src

## Purpose
v0.4 SDK source: type interfaces, the `runBacktest` and `runLive` runtime loops, the feature library, the tactical/v1 dialect, and reference implementations of `Calendar` / `FeatureCache` / `Executor`. Public API surface is the `index.ts` barrel.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Public API barrel — `runBacktest`, `runLive`, `tactical`, `features`, reference impls (`MemoryFeatureCache`, `BacktestExecutor`, `NYSEExchangeCalendar`, `LSEExchangeCalendar`, `Crypto24x7Calendar`), type exports |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `interfaces/` | v0.4 type surface: `Strategy`, `Calendar`, `DataFeed`, `StreamingDataFeed`, `Executor`, `FeatureCache`, primitives (see `interfaces/AGENTS.md`) |
| `strategy/` | `runBacktest` + `runLive` runtime loops and `reconcile` helper (see `strategy/AGENTS.md`) |
| `features/` | Indicator math, `FeatureSpec` registry, `FeatureRuntime` orchestrator (historical + streaming modes; see `features/AGENTS.md`) |
| `tactical/` | `tactical/v1` dialect, `fromSpec`, rule-tree evaluator, synthetic-asset wrapper (see `tactical/AGENTS.md`) |
| `calendars/` | `ExchangeCalendar` base + `NYSEExchangeCalendar` / `LSEExchangeCalendar` / `Crypto24x7Calendar` + holiday-rule helpers + `getCalendar` registry (see `calendars/AGENTS.md`) |
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
User code → tactical.fromSpec(spec, { runtime, calendar }) → Strategy<F, S>
  → runBacktest({ strategy, dataFeed, calendar, executor, featureCache, range, initialPortfolio })
  → BacktestResult { snapshots, finalPortfolio, finalState, bars }
  → runLive(result, { strategy, calendar, executor, streamingDataFeed, ... })
  → AsyncIterable<LiveEvent<mark | snapshot>>
```

Per backtest session: `strategy.universe(t)` → `strategy.features(universe, portfolio, t)` (calls `FeatureRuntime` against `DataFeed` + `FeatureCache`) → `strategy.build(features, portfolio, t, state)` produces `{ orders, state }` → `Executor.submit(orders)` produces `Fill[]` → `applyFills(portfolio, fills)`.

Per live tick: `streamingDataFeed.subscribe(assets)` yields `StreamingBar` → `FeatureRuntime.appendBar` (streaming mode) → preview-build via `structuredClone(state)` produces `previewOrders` for the `mark` event. On `calendar.next(currentSession) <= bar.t`, the runtime commits: features re-evaluate, `strategy.build` runs against committed state, orders go to `Executor`, fills apply, a `snapshot` event emits (identical shape to `BacktestSnapshot`).

### Testing Requirements
- Tests are co-located (`*.test.ts` next to implementation)
- Mock `DataFeed` and `Executor` with `vi.fn()` or use the in-memory reference impls
- The sdk root tsconfig excludes `**/*.test.ts` from tsc; vitest type-checks at runtime

### Common Patterns
- **Spec-driven strategies**: strategies are declarative `TacticalSpec` objects, hydrated by `tactical.fromSpec` into a runnable `Strategy<F, S>` (state-threaded; `S` defaults to `void` for stateless strategies)
- **Pluggable runtime layers**: `DataFeed`, `StreamingDataFeed`, `Executor`, `Calendar`, `FeatureCache` are interfaces — swap independently
- **Content-addressed feature cache**: `(feature spec, asset, date)` is the cache key. `MemoryFeatureCache` is in-process; cross-process caches implement `FeatureCache`. In streaming mode, `FeatureRuntime` bypasses the persistent cache and serves features from its in-memory bar buffer
- **Reconcile helper**: `reconcile(currentPositions, targetWeights, totalValue, prices)` produces orders that move from current to target — used by `tactical.fromSpec` internally and available for hand-written strategies
- **Replay-then-stream**: `runBacktest` exports `finalState` + `bars` on its result; `runLive` consumes both to seed a `streamingRuntime: FeatureRuntime` (streaming mode, `initialBars` from the backtest) and continue the strategy uninterrupted. Pass the same `streamingRuntime` to `fromSpec` so its `features` closure captures the right runtime instance

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
