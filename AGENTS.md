<!-- Generated: 2026-04-01 | Updated: 2026-04-01 -->

# @livefolio/sdk

## Purpose
TypeScript SDK for building tactical allocation strategies. Provides a fluent API to define tickers, technical indicators, comparison signals, allocation rules, and complete strategies — backed by a Supabase database for persistence and time-series storage. Includes a backtesting simulation engine.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Project manifest — `@livefolio/sdk`, ES module, Node >=20 |
| `tsconfig.json` | TypeScript strict mode, ES2022 target, bundler module resolution |
| `tsup.config.ts` | tsup bundler configuration |
| `vitest.config.ts` | Vitest test runner configuration |
| `eslint.config.js` | ESLint flat config with typescript-eslint and Prettier |
| `.prettierrc` | Prettier formatting rules |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `src/` | All TypeScript source code (see `src/AGENTS.md`) |
| `docs/` | Design specs and implementation plans (see `docs/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- This is an ES module project (`"type": "module"`) — extensionless imports, bundled with tsup
- The SDK exports a `createClient(options)` factory that returns a `LivefolioClient` interface
### Testing Requirements
- Run `npm test` to execute all Vitest tests
- Tests use Vitest's `vi.fn()` for mocking — no real database connection needed

### Common Patterns
- **Handle pattern**: Core abstractions (`TickerHandle`, `IndicatorHandle`, etc.) are lazy — they defer database resolution until `.resolve()` is called
- **Fluent builder API**: `createClient` returns methods like `.ticker()`, `.sma()`, `.gt()`, `.strategy()` that compose handles together
- **Upsert-on-resolve**: Handles upsert their identity rows on first resolve, returning existing rows if they match

## Dependencies

### External
- `nanoid` — Short unique IDs for strategy link URLs

### Dev
- `tsup` — Bundler
- `vitest` — Test runner
- `typescript` — Compiler
- `eslint` + `typescript-eslint` — Linting
- `prettier` — Formatting
- `husky` + `lint-staged` — Pre-commit hooks

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
