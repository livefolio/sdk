<!-- Parent: ../AGENTS.md -->

# src/reference

## Purpose
Reference implementations of the runtime interfaces declared in `src/interfaces/`. Each one is the canonical in-process default that ships in the box. Consumers can swap any of them for production-specific impls (e.g. `LiveBrokerExecutor`, `RedisFeatureCache`) without touching strategy code.

## Key Files

| File | Description |
|------|-------------|
| `memory-feature-cache.ts` | `MemoryFeatureCache implements FeatureCache` — in-process Map, no persistence |
| `backtest-executor.ts` | `BacktestExecutor implements Executor` — fills orders at next-open price, tracks cash/positions, no slippage or fees |
| `index.ts` | Barrel |

## For AI Agents

### Working In This Directory
- These are **reference** impls. Aim for clarity over performance; production deployments should swap their own
- New reference impl? Add it here, export from `index.ts`, add to root `src/index.ts`
- Don't extend the interfaces themselves — that's `src/interfaces/`'s job. Reference impls only implement what's already declared

### Testing Requirements
- Each reference impl has a co-located test exercising the interface contract

### Common Patterns
- **In-process, single-tenant** — reference impls assume one process, no concurrency, no persistence
- **No external dependencies** — reference impls don't pull in optional deps; they rely only on the standard library
