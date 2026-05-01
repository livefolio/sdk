<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-04-01 -->

# docs

## Purpose
Design specifications and implementation plans for SDK features. Each feature has a paired spec (design rationale, API surface) and plan (step-by-step implementation).

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `specs/` | Design documents defining API shape, data flow, and edge cases |
| `plans/` | Step-by-step implementation plans referencing the corresponding spec |

## Key Files

### specs/
| File | Description |
|------|-------------|
| `2026-03-30-lazy-handle-api-design.md` | Lazy handle pattern and fluent API design |
| `2026-03-30-indicator-sync-design.md` | Indicator time-series sync from providers |
| `2026-03-30-signal-handle-design.md` | Signal comparison handle design |
| `2026-03-30-allocation-handle-design.md` | Allocation (weighted holdings) handle |
| `2026-03-31-strategy-handle-design.md` | Strategy rule engine and series evaluation |
| `2026-03-31-portfolio-handle-design.md` | Portfolio handle for tracking positions |
| `2026-03-31-simulation-design.md` | Backtesting simulation engine design |
| `2026-04-01-simulate-portfolio-design.md` | Simulate with starting portfolio positions |
| `2026-04-26-simulation-metrics-design.md` | Simulation metrics module (returns/risk/risk-adjusted/activity/tables) |
| `2026-04-28-generalized-strategy-architecture-design.md` | Forward-looking architecture: four-layer stack and generalized strategy shape covering all strategy families |
| `2026-04-29-v0.4-multi-repo-interface-design.md` | v0.4 SDK overhaul: package layout, interface contracts (DataFeed/Executor/FeatureCache/Calendar), spec dialects, and migration plan |

### plans/
| File | Description |
|------|-------------|
| `2026-03-30-lazy-handle-tickers-indicators.md` | Plan for ticker and indicator handles |
| `2026-03-30-indicator-sync.md` | Plan for indicator sync pipeline |
| `2026-03-30-signal-handle.md` | Plan for signal handle implementation |
| `2026-03-31-portfolio-handle.md` | Plan for portfolio handle |
| `2026-03-31-strategy-handle.md` | Plan for strategy handle |
| `2026-03-31-simulation.md` | Plan for simulation engine |
| `2026-04-01-simulate-portfolio.md` | Plan for portfolio-based simulation |
| `2026-04-26-simulation-metrics.md` | Plan for simulation metrics module |
| `2026-05-01-v0.4-phase-1-core-types.md` | v0.4 Phase 1 — core types, interfaces, and reference impls |

## For AI Agents

### Working In This Directory
- Specs are the source of truth for API design decisions
- Plans reference their corresponding spec — read the spec first for context
- Files are date-prefixed for chronological ordering
- When adding a new feature, create both a spec and a plan

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
