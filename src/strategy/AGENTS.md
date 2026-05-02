<!-- Parent: ../AGENTS.md -->

# src/strategy

## Purpose
The runtime. `runBacktest` is the per-session loop that drives a `Strategy<F>` against a `DataFeed`/`Executor`/`Calendar`/`FeatureCache`. `reconcile` is a small helper that turns a target-weights map into the orders needed to move a portfolio from current to target — used by `tactical.fromSpec` and available for hand-written strategies.

## Key Files

| File | Description |
|------|-------------|
| `types.ts` | `Strategy<F>` and `Features` interfaces |
| `run-backtest.ts` | `runBacktest(opts) → BacktestResult`. Walks `calendar.sessions(range)`, calls `strategy.universe → features → build`, submits orders, applies fills, records snapshots |
| `reconcile.ts` | `reconcile(positions, targets, totalValue, prices) → Order[]`. Deterministic; no calendar awareness |
| `index.ts` | Barrel |

## For AI Agents

### Working In This Directory
- `runBacktest` is the canonical entry point — most consumers go through it
- `Strategy.features()` is async (returns `F | Promise<F>`) — `runBacktest` awaits before passing to `build`
- The loop is single-threaded per session; ordering is deterministic
- Snapshots are appended every session, including non-rebalance days (zero orders, no fills)

### Testing Requirements
- `run-backtest.test.ts` covers the loop with stub strategies and mock executors
- `integration.test.ts` exercises the full v0.4 stack (FeatureRuntime → fromSpec → runBacktest)

### Common Patterns
- **Pure orchestration** — `runBacktest` itself contains no domain logic. Strategy semantics live in `Strategy.features` / `Strategy.build`; execution semantics live in the `Executor`
- **Snapshot-per-session** — `result.snapshots` has one entry per calendar session in `range`, suitable for downstream metrics computation
