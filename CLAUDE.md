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

- **auth** — Authentication wrapping Supabase Auth
- **market** — Market data (series, quotes, trading calendar) via Edge Functions and direct queries
- **strategy** — Strategy retrieval, evaluation (pure + cached), live streaming
- **portfolio** — Brokerage account aggregation (stub)

The root `src/index.ts` re-exports all modules and provides `createLivefolioClient()` which wires everything from a single `TypedSupabaseClient`.

See `docs/` for full method documentation and usage examples.

### Module convention

`src/` contains domain module folders. Each module follows this structure:

```
src/<module>/
├── index.ts          ← barrel re-exports only (no logic)
├── types.ts          ← module interface + all domain types
├── client.ts         ← createX() factory — minimal wiring only
├── client.test.ts    ← wiring tests (verify shape + delegation)
├── <feature>.ts      ← function implementation(s)
└── <feature>.test.ts ← tests for that implementation
```

**Rules:**
- `index.ts` — pure barrel file, only `export type` and `export` re-statements
- `types.ts` — module interface (e.g. `StrategyModule`) and all domain types
- `client.ts` — **minimal wiring only**. Import functions from implementation files, return an object that delegates to them. No business logic.
- Every `<feature>.ts` must have a corresponding `<feature>.test.ts`
- `client.test.ts` only verifies factory shape and delegation
- **100% unit test coverage** of all exported functions
- Update `docs/` when adding or changing module methods

## Testing

Tests use vitest and mock the Supabase client. Aim for **100% unit test coverage**.

- Every `<feature>.ts` must have a corresponding `<feature>.test.ts`
- Test every exported function's success path, error path, and edge cases
- `client.test.ts` only tests wiring — keep it lightweight
- Mock the Supabase client at the boundary; test implementation logic directly

## CI/CD

- **test.yml** (PR → main) — installs, builds, runs tests, checks version bump
- **release.yml** (push to main) — builds, tests, publishes to npm, creates GitHub release

Before merging a PR, run `npm version patch` (or minor/major). The test workflow blocks if you forget.

## Publishing

Published to npm as `@livefolio/sdk`. The release workflow handles `npm publish` automatically on merge to main.
