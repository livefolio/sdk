# @livefolio/sdk

TypeScript SDK for market data, strategy evaluation, and portfolio management.

## Install

```bash
npm install @livefolio/sdk
```

## Getting Started

All modules are created from a single Supabase client:

```ts
import { createLivefolioClient } from '@livefolio/sdk';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const livefolio = createLivefolioClient(supabase);
```

Individual modules can also be imported directly:

```ts
import { createMarket } from '@livefolio/sdk/market';
import { createAuth } from '@livefolio/sdk/auth';
import { createStrategy } from '@livefolio/sdk/strategy';
```

---

## Auth

Wraps Supabase Auth with a simplified interface.

| Method | Returns | Description |
|--------|---------|-------------|
| `getUser()` | `User \| null` | Get the current authenticated user, or `null` if not signed in |
| `getSession()` | `Session \| null` | Get the current session |
| `requireUser()` | `User` | Get the current user or throw if not authenticated |
| `onAuthStateChange(callback)` | `Subscription` | Subscribe to auth state changes (sign in, sign out, token refresh) |
| `signOut()` | `void` | Sign out the current user |

```ts
const user = await livefolio.auth.getUser();

const subscription = livefolio.auth.onAuthStateChange((event, session) => {
  console.log(event, session);
});
```

---

## Market

Provides historical price series, real-time quotes, and the trading calendar. Series and quotes are served through Supabase Edge Functions with transparent cache-through behavior — the SDK requests data and caching is handled server-side.

### Series

Retrieve historical daily observations for one or more symbols. Each observation has an ISO 8601 `timestamp` (market close) and a `value` (closing price).

```ts
const spy = await livefolio.market.getSeries('SPY');
// spy: Observation[] — [{ timestamp: '2025-01-10T21:00:00Z', value: 590.25 }, ...]

const batch = await livefolio.market.getBatchSeries(['SPY', 'QQQ', 'TLT']);
// batch: Record<string, Observation[]> — { SPY: [...], QQQ: [...], TLT: [...] }
```

### Quotes

Retrieve the latest real-time quote for one or more symbols.

```ts
const quote = await livefolio.market.getQuote('SPY');
// quote: Observation — { timestamp: '2025-03-02T21:00:00Z', value: 592.10 }

const quotes = await livefolio.market.getBatchQuotes(['SPY', 'QQQ']);
// quotes: Record<string, Observation>
```

### Trading Calendar

Query the trading calendar for market open/close times. Dates are `YYYY-MM-DD` strings.

```ts
const days = await livefolio.market.getTradingDays('2025-01-01', '2025-12-31');
// days: TradingDay[] — [{ date, open, close, extended_open, extended_close }, ...]

const today = await livefolio.market.getTradingDay('2025-03-02');
// today: TradingDay | null
```

---

## Strategy

Handles strategy retrieval, evaluation, and result caching. The module exposes two evaluation paths:

- **`evaluate()`** (async) — the primary API. Checks the DB cache for a prior result, returns it on hit, or runs a fresh evaluation and stores the result on miss. Consumers never need to manage caching manually.
- **Pure functions** (sync) — `evaluateIndicator`, `evaluateSignal`, `evaluateAllocation` for direct computation without DB interaction. Useful for testing, debugging, or custom pipelines.

### Retrieving Strategies

Fetch a fully-resolved strategy by its link ID. The `get()` method calls the `strategy` edge function, which looks up the strategy in the database and auto-imports from testfol.io if not found. The returned `Strategy` object contains all named signals, indicators, condition trees, and allocations ready for evaluation.

```ts
const strategy = await livefolio.strategy.get('abc-123');
// strategy: Strategy | null

const strategies = await livefolio.strategy.getMany(['abc-123', 'def-456']);
// strategies: Record<string, Strategy>
```

### Evaluating a Strategy

The `evaluate` method is the standard way to run a strategy. Pass a strategy and a date — everything else is handled internally:

1. Fetches historical series for all symbols used by the strategy
2. Computes the evaluation date
3. Checks the DB cache for a prior result on that trading day
4. On cache miss: fetches prior signal states (for hysteresis) and indicator metadata (for incremental EMA/RSI), runs the evaluation, and stores the result
5. On cache hit: returns the cached allocation and signal states

```ts
const strategy = await livefolio.strategy.get('abc-123');
if (strategy) {
  const result = await livefolio.strategy.evaluate(strategy, new Date());

  result.allocation;   // the winning allocation (name, holdings)
  result.evaluatedAt;  // Date the evaluation corresponds to
  result.signals;      // Record<string, boolean> — all signal states
  result.indicators;   // Record<string, IndicatorEvaluation> — all indicator values
}
```

### Utilities

| Method | Returns | Description |
|--------|---------|-------------|
| `extractSymbols(strategy)` | `string[]` | Collect all ticker symbols needed to evaluate a strategy (from signals + holdings) |
| `getEvaluationDate(trading, options)` | `Date`            | Compute the evaluation date — requires `EvaluationOptions` with series data |

### Pure Evaluation Functions

For advanced use cases (testing, backtesting, custom pipelines), the pure evaluation functions operate synchronously without any DB interaction. They accept `EvaluationOptions` with `batchSeries` and optionally `previousSignalStates` and `previousIndicatorMetadata`.

```ts
import { evaluate, evaluateIndicator, evaluateSignal } from '@livefolio/sdk/strategy';

// Evaluate a single indicator
const smaResult = livefolio.strategy.evaluateIndicator(indicator, options);

// Evaluate a signal (comparison of two indicators)
const isAbove = livefolio.strategy.evaluateSignal(signal, options);

// Evaluate a full allocation condition tree
const matches = livefolio.strategy.evaluateAllocation(allocation, options);
```

---

## Portfolio

Brokerage account aggregation and trade order management. This module is planned but not yet implemented.

---

## Development

```bash
npm install
npm run build    # compile TypeScript → dist/
npm test         # run tests
```

## CI/CD

- PRs to `main` run build + tests and enforce a version bump
- Merges to `main` auto-publish to npm and create a GitHub release

Before merging, bump the version:

```bash
npm version patch
```

## License

MIT
