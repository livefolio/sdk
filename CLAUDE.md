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
- **market** — Market data retrieval (series, quotes, trading calendar) via Supabase Edge Functions and direct queries
- **strategy** — Strategy definition retrieval, pure evaluation (indicators, signals, conditions, allocations), and evaluation caching
- **portfolio** — Brokerage account aggregation and trade order management (stub)

The root `src/index.ts` re-exports all modules as namespaces and provides `createLivefolioClient()` which wires everything together from a single `TypedSupabaseClient`.

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
- `index.ts` must be a pure barrel file — only `export type` and `export` re-statements, no logic
- `types.ts` holds the module interface (e.g. `StrategyModule`) and all domain types
- `client.ts` holds the `createX()` factory that returns the module interface. It must be **minimal wiring** — import functions from their implementation files and return an object that delegates to them. No business logic in `client.ts`.
- Every implementation file (`<feature>.ts`) must have a corresponding test file (`<feature>.test.ts`). Tests import directly from the implementation file, not through the client.
- `client.test.ts` only verifies that the factory returns the correct shape and delegates to the right functions. The heavy testing lives in per-feature test files.
- **100% unit test coverage** of all exported functions. Every success path, error path, and edge case must be tested.
- New modules must follow this same pattern

### Key types

```ts
interface Observation { timestamp: string; value: number }  // ISO 8601 timestamp
interface TradingDay { date: string; open: string; close: string; extended_open: string; extended_close: string }
```

### MarketModule methods

| Method | Edge Function | Returns |
|--------|--------------|---------|
| `getSeries(symbol)` | `series` | `Observation[]` |
| `getBatchSeries(symbols)` | `series` | `Record<string, Observation[]>` |
| `getQuote(symbol)` | `quote` | `Observation` |
| `getBatchQuotes(symbols)` | `quote` | `Record<string, Observation>` |
| `getTradingDays(start, end)` | direct query | `TradingDay[]` |
| `getTradingDay(date)` | direct query | `TradingDay \| null` |

### StrategyModule methods

| Method | Category | Description |
|--------|----------|-------------|
| `get(linkId)` | Retrieval | Fetch a fully-resolved Strategy via `strategy` edge function (DB lookup + testfol.io auto-import) |
| `getMany(linkIds)` | Retrieval | Batch fetch strategies by link IDs |
| `evaluate(strategy, at)` | Cache-through | Async self-contained evaluation — fetches series, checks cache, evaluates on miss |
| `evaluateIndicator(indicator, options)` | Pure eval | Evaluate a single indicator (SMA, EMA, RSI, etc.) — accepts `EvaluationOptions` |
| `evaluateSignal(signal, options)` | Pure eval | Compare two indicators with dead-band hysteresis — accepts `EvaluationOptions` |
| `evaluateAllocation(allocation, options)` | Pure eval | Evaluate a condition tree (AND/OR/NOT of signals) — accepts `EvaluationOptions` |
| `getEvaluationDate(trading, options)` | Pure eval | Compute evaluation date — accepts `EvaluationOptions` (needs batchSeries) |
| `extractSymbols(strategy)` | Utility | Extract all ticker symbols needed for evaluation |
| `stream(strategy, observation)` | Live | Merge a single observation into historical series, evaluate without caching |
| `backtest(strategy, options)` | Stub | Not yet implemented |

### Strategy domain model

- **Indicator** — a single metric (SMA, EMA, RSI, Price, VIX, etc.) with ticker, lookback, delay
- **Signal** — comparison of two indicators with tolerance (dead-band hysteresis)
- **Condition** — boolean expression tree: `OR(AND(...), AND(...))` where leaves are `signal` or `NOT(signal)`
- **Allocation** — a condition + holdings (tickers + weights)
- **NamedAllocation** — allocation with a name and position (priority order; internal)
- **AllocationEvaluation** — flattened allocation result (name, holdings)
- **Strategy** — signals + allocations + trading frequency

Signals use a **definition/named-instance split**: signal definitions are strategy-agnostic (shared via unique constraint on indicator pair + comparison + tolerance), while `signals` (named instances) are strategy-scoped. Allocations keep name/position directly on the table.

## Testing

**Every code change must include corresponding tests.** Tests use vitest and mock the Supabase client. Aim for **100% unit test coverage**.

- Every implementation file (`<feature>.ts`) must have a corresponding `<feature>.test.ts`
- Test every exported function's success path, error path, and edge cases
- `client.test.ts` only tests wiring (correct shape, delegation) — keep it lightweight
- Mock the Supabase client at the boundary; test implementation logic directly

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
