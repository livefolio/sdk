# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development

```bash
npm run build        # compile TypeScript (tsc) → dist/
npm run clean        # remove dist/
npm test             # run tests (vitest)
npm run test:watch   # run tests in watch mode
```

## Architecture

`@livefolio/sdk` is a TypeScript SDK with four domain modules:

- **auth** — Authentication (user, session, sign-out) wrapping Supabase Auth
- **market** — Market data retrieval (series, trading calendar) via Supabase Edge Functions and direct queries
- **evaluator** — Strategy allocation evaluation, indicators, signals, and backtesting (stub)
- **portfolio** — Brokerage account aggregation and trade order management (stub)

The root `src/index.ts` re-exports all modules as namespaces and provides `createLivefolioClient()` which wires everything together from a single `TypedSupabaseClient`.

### Module convention

Each module directory follows this structure:

```
src/<module>/
├── index.ts        ← barrel re-exports only (no logic)
├── types.ts        ← domain types + module interface
├── client.ts       ← createX() factory (implementation)
└── client.test.ts  ← tests (imports from client.ts)
```

**Rules:**
- `index.ts` must be a pure barrel file — only `export type` and `export` re-statements, no logic
- `types.ts` holds the module interface (e.g. `MarketModule`) and all domain types
- `client.ts` holds the `createX()` factory that returns the module interface
- Tests go in `client.test.ts` and import directly from `./client`
- New modules must follow this same pattern

### Imports

Consumers can import the full SDK or individual modules via the `exports` map in package.json:

```ts
import { market, auth } from '@livefolio/sdk';
import { createMarket } from '@livefolio/sdk/market';
```

### Build output

TypeScript compiles to CommonJS (`dist/`) with declarations, declaration maps, and source maps. Target is ES2022. Strict mode is enabled.

## CI/CD

Two GitHub Actions workflows in `.github/workflows/`:

- **test.yml** (PR → main) — installs, builds, runs tests, checks that `package.json` version was bumped vs main
- **release.yml** (push to main) — builds, tests, publishes to npm, creates a GitHub release

**Before merging a PR**, always run `npm version patch` (or minor/major) to bump the version. The test workflow will block the PR if you forget.

## Publishing

Published to the public npm registry as `@livefolio/sdk`. The release workflow handles `npm publish` automatically on merge to main — no manual publishing needed.
