<!-- Parent: ../AGENTS.md -->

# src/strategy

## Purpose
The runtime. `runBacktest` is the per-session loop that drives a `Strategy<F, S>` against a `DataFeed`/`Executor`/`Calendar`/`FeatureCache`. `runLive` is the live-evaluation async generator that continues from a `BacktestResult` and emits `LiveEvent<mark | snapshot>` ticks against a `StreamingDataFeed`. `reconcile` is a small helper that turns a target-weights map into the orders needed to move a portfolio from current to target — used by `tactical.fromSpec` and available for hand-written strategies.

## Key Files

| File | Description |
|------|-------------|
| `types.ts` | `Strategy<F, S>` and `Features` interfaces. `S` defaults to `void` (stateless) and `build` may return either `ReadonlyArray<Order>` (legacy) or `{ orders, state }` (state-threaded). Optional `initialState?(): S` seeds the first session |
| `run-backtest.ts` | `runBacktest(opts) → BacktestResult { snapshots, finalPortfolio, finalState, bars }`. Walks `calendar.sessions(range)`, calls `strategy.universe → features → build`, submits orders, applies fills, records snapshots. Threads `state` across sessions; exports per-asset `bars` when `RunBacktestOptions.featureRuntime` is provided so `runLive` can seed its streaming runtime |
| `run-live.ts` | `runLive(result, opts) → AsyncIterable<LiveEvent<F, S>>`. Subscribes to the `StreamingDataFeed`, seeds session cursor at `calendar.next(history.lastSnapshot.t)`, emits `mark` per tick (preview-build via `structuredClone(state)`) and `snapshot` per session close |
| `reconcile.ts` | `reconcile(positions, targets, totalValue, prices) → Order[]`. Deterministic; no calendar awareness |
| `index.ts` | Barrel |

## For AI Agents

### Working In This Directory
- `runBacktest` is the canonical entry point for historical replay; `runLive` continues a backtest into live evaluation
- `Strategy.features()` is async (returns `F | Promise<F>`) — `runBacktest`/`runLive` await before passing to `build`
- The loop is single-threaded per session; ordering is deterministic
- Snapshots are appended every session, including non-rebalance days (zero orders, no fills)
- `runLive`'s `mark` event runs `strategy.build` against a `structuredClone(state)` so committed state is never mutated by the per-tick preview. State containing non-cloneable values (functions, DOM nodes, etc.) will throw — keep state JSON-shaped

### Testing Requirements
- `run-backtest.test.ts` covers the loop with stub strategies and mock executors
- `run-live.test.ts` covers session-boundary detection, mark/snapshot emission, state continuity, and preview-build isolation
- `integration.test.ts` exercises the full v0.4 stack (FeatureRuntime → fromSpec → runBacktest)

### Common Patterns
- **Pure orchestration** — `runBacktest`/`runLive` contain no domain logic. Strategy semantics live in `Strategy.features` / `Strategy.build`; execution semantics live in the `Executor`
- **Snapshot-per-session** — `result.snapshots` has one entry per calendar session in `range`, suitable for downstream metrics computation
- **Replay-then-stream** — `runBacktest` returns `{ finalState, bars }`; `runLive` accepts both via the seeding `BacktestResult`. Pass an explicit `streamingRuntime: FeatureRuntime` (built in `'streaming'` mode with `initialBars` from `result.bars`) so it can be shared with `fromSpec` strategies whose `features` closure must capture the same runtime instance
