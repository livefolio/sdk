<!-- Generated: 2026-04-01 | Updated: 2026-05-02 -->

# @livefolio/sdk

## Purpose
TypeScript SDK for building tactical allocation strategies. Strategies are declared as `TacticalSpec` (universe, features, rebalance schedule, rule tree) and executed by `runBacktest` against pluggable runtime layers — `DataFeed` for market data, `Calendar` for trading-day arithmetic, `FeatureCache` for indicator memoization, `Executor` for order routing. Reference implementations (`NYSEExchangeCalendar`, `LSEExchangeCalendar`, `MemoryFeatureCache`, `BacktestExecutor`) ship in the box.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Project manifest — `@livefolio/sdk@0.4.0`, ES module, Node >=20 |
| `tsconfig.json` | TypeScript strict mode, ES2022 target, bundler module resolution |
| `tsup.config.ts` | tsup bundler configuration |
| `vitest.config.ts` | Vitest test runner configuration with `@livefolio/sdk/*` subpath aliases |
| `eslint.config.js` | ESLint flat config with typescript-eslint and Prettier |
| `.prettierrc` | Prettier formatting rules |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | v0.4 SDK source (see `src/AGENTS.md`) |
| `docs/` | Design specs and implementation plans (see `docs/AGENTS.md`) |
| `docs-site/` | VitePress + TypeDoc documentation site published to GitHub Pages |
| `parity/` | Regression workspace: hosts v0.3 source under `parity/src/v3/` and the v0.4↔v0.3 parity gate |
| `scripts/` | Standalone demo and verification scripts; `scripts/docs/` holds runnable code samples embedded in the docs site |
| `.claude/skills/` | Claude Code skills for SDK authoring (`livefolio-tactical-author`, `livefolio-custom-adapter`, `livefolio-debug-strategy`) |

## For AI Agents

### Working In This Directory
- This is an ES module project (`"type": "module"`) — extensionless imports, bundled with tsup
- The SDK exports `runBacktest`, `tactical.fromSpec`, `Strategy`/`DataFeed`/`Calendar`/`FeatureCache`/`Executor` types, plus reference impls
- Public API is v0.4 only. v0.3 (`createClient`, fluent handles) lives in `parity/src/v3/` as the regression target — do not re-export from `src/index.ts`

### Testing Requirements
- Run `npm test` to execute all Vitest tests (sdk + parity workspaces via aliases)
- Tests use Vitest's `vi.fn()` for mocking external boundaries
- Reference impls (`MemoryFeatureCache`, `BacktestExecutor`) work as in-memory test fixtures — no external services needed

### Common Patterns
- **Spec-driven strategies**: `TacticalSpec` is plain data. `tactical.fromSpec(spec, { runtime, calendar })` hydrates it into a `Strategy<F>` that `runBacktest` can drive
- **Pluggable runtime layers**: `DataFeed`, `Executor`, `Calendar`, `FeatureCache` are interfaces. Reference impls ship; consumers swap any layer (e.g. `LiveBrokerExecutor`) without touching strategy code
- **Content-addressed feature cache**: indicator results are keyed by `(feature spec, asset, date)`. `MemoryFeatureCache` is the in-process default; cross-process caches plug in by implementing the interface

## Dependencies

### External
- `luxon` — TZ-aware datetime arithmetic for `ExchangeCalendar` (NYSE/LSE schedule resolution)

### Dev
- `tsup` — Bundler
- `vitest` — Test runner
- `tsx` — Dev script runner
- `typescript` — Compiler
- `eslint` + `typescript-eslint` — Linting
- `prettier` — Formatting
- `husky` + `lint-staged` — Pre-commit hooks
- `vitepress` + `typedoc` + `typedoc-plugin-markdown` + `typedoc-vitepress-theme` — Docs site generation

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
