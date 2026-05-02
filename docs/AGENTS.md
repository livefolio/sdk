<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-05-02 -->

# docs

## Purpose
Design specifications and implementation plans for SDK features. Each feature has a paired spec (design rationale, API surface) and plan (step-by-step implementation). Both directories are date-prefixed and append-only — historical record, not rewritten.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `specs/` | Design documents defining API shape, data flow, and edge cases |
| `plans/` | Step-by-step implementation plans referencing the corresponding spec |

## Anchor documents

The two specs that define current architecture:

- `specs/2026-04-28-generalized-strategy-architecture-design.md` — four-layer stack, generalized strategy shape covering tactical / strategic / momentum / risk-parity / etc. as a single interface
- `specs/2026-04-29-v0.4-multi-repo-interface-design.md` — v0.4 SDK package layout, interface contracts (`DataFeed`, `Executor`, `FeatureCache`, `Calendar`), spec dialects

The v0.4 rollout is structured as numbered phases, each with a spec and a plan in this directory:

- Phase 1 — core types and reference impls
- Phase 2 — feature library and `FeatureRuntime`
- Phase 3 — `tactical/v1` dialect and `fromSpec`
- Phase 4 — yfinance `DataFeed` adapter (lives in sibling repo `~/Documents/Personal/livefolio-2/yfinance/`; this repo has only a stub)
- Phase 5 — parity gate (v0.4 ↔ v0.3 allocation-history regression test)
- Phase 6 — relocate v0.3 to `parity/src/v3/`, flip `src/index.ts` to v0.4-only
- Phase 7 — documentation refresh (this round)
- Phase 8 — comprehensive user wiki / hosted docs site (VitePress + TypeDoc), runnable code samples under `scripts/docs/`, and focused agent skills (`livefolio-tactical-author`, `livefolio-custom-adapter`, optional `livefolio-debug-strategy`). See `specs/2026-05-02-v0.4-phase-8-wiki-docs-design.md` and `plans/2026-05-02-v0.4-phase-8-wiki-docs.md`.

`specs/2026-05-02-v0.4-parity-divergences.md` codifies the structural allowances the parity gate accepts.

`plans/2026-05-02-calendars-module.md` (companion spec `specs/2026-05-02-calendars-module-design.md`) — multi-exchange calendar framework: `ExchangeCalendar` base + `NYSEExchangeCalendar` + `LSEExchangeCalendar`. Supersedes the deferred `plans/2026-05-02-nyse-calendar.md` brainstorm.

## For AI Agents

### Working In This Directory
- Specs are the source of truth for API design decisions; plans translate specs into checkbox-tracked tasks
- Files are date-prefixed for chronological ordering
- Don't rewrite landed specs/plans — append a new dated doc that supersedes if needed
- For new features, create both a spec (design rationale) and a plan (task breakdown)

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
