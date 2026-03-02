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

Each module directory follows this structure:

```
src/<module>/
├── index.ts        ← barrel re-exports only (no logic)
├── types.ts        ← domain types + module interface
├── client.ts       ← createX() factory (implementation)
└── client.test.ts  ← tests (imports from client.ts)
```

The strategy module has additional files for pure logic:

```
src/strategy/
├── evaluate.ts       ← pure evaluation functions (indicators, signals, conditions)
├── evaluate.test.ts  ← evaluation tests
├── symbols.ts        ← INDICATOR_SYMBOL_MAP + extractSymbols
└── time.ts           ← utcToET, isAtMarketClose
```

**Rules:**
- `index.ts` must be a pure barrel file — only `export type` and `export` re-statements, no logic
- `types.ts` holds the module interface (e.g. `MarketModule`) and all domain types
- `client.ts` holds the `createX()` factory that returns the module interface
- Tests go in `client.test.ts` and/or `evaluate.test.ts` and import directly from source
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
| `backtest(strategy, options)` | Stub | Not yet implemented |

### Strategy domain model

- **Indicator** — a single metric (SMA, EMA, RSI, Price, VIX, etc.) with ticker, lookback, delay
- **Signal** — comparison of two indicators with tolerance (dead-band hysteresis)
- **Condition** — boolean expression tree: `OR(AND(...), AND(...))` where leaves are `signal` or `NOT(signal)`
- **Allocation** — a condition + holdings (tickers + weights)
- **NamedAllocation** — allocation with a name and position (priority order; internal)
- **AllocationEvaluation** — flattened allocation result (name, holdings)
- **Strategy** — named signals + allocations + trading frequency

Signals use a **definition/named-instance split**: signal definitions are strategy-agnostic (shared via unique constraint on indicator pair + comparison + tolerance), while `named_signals` are strategy-scoped. Allocations keep name/position directly on the table.

## Testing

**Every code change must include corresponding tests.** Tests use vitest and mock the Supabase client. Each module's `client.test.ts` must cover:

- Every method's success path (correct invoke args and return shape)
- Error paths (invoke errors, missing data)
- Thin wrappers (verify delegation to batch method)

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
