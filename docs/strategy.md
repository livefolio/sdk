# Strategy Module

Strategy definition retrieval, evaluation (pure and cached), live streaming, and utilities.

## Methods

### `get(linkId)`

Fetches a fully-resolved strategy by its link ID.

| Parameter | Type     | Description                          |
|-----------|----------|--------------------------------------|
| `linkId`  | `string` | Strategy link ID (from testfol.io)   |

**Returns** `Promise<Strategy | null>` — `null` if not found or on error (never throws).

```ts
const strategy = await livefolio.strategy.get('abc-123');
if (strategy) {
  console.log(strategy.name, strategy.trading.frequency);
}
```

> The Edge Function performs a DB lookup and auto-imports from testfol.io if not found locally.

---

### `getMany(linkIds)`

Batch-fetches strategies by link IDs.

| Parameter | Type       | Description                    |
|-----------|------------|--------------------------------|
| `linkIds` | `string[]` | Array of strategy link IDs     |

**Returns** `Promise<Record<string, Strategy>>` — keyed by link ID. Missing or errored strategies are silently omitted.

```ts
const strategies = await livefolio.strategy.getMany(['abc-123', 'def-456']);
// Only successfully fetched strategies appear in the result
if (strategies['abc-123']) { /* ... */ }
```

> Fetches are parallelized via `Promise.all`. Returns `{}` for empty input.

---

### `evaluate(strategy, at)`

Cache-through evaluation. Fetches market data, checks the DB cache, evaluates on miss, and stores the result.

| Parameter  | Type       | Description                        |
|------------|------------|------------------------------------|
| `strategy` | `Strategy` | Fully-resolved strategy object     |
| `at`       | `Date`     | Evaluation timestamp               |

**Returns** `Promise<StrategyEvaluation>`

```ts
const result = await livefolio.strategy.evaluate(strategy, new Date());
console.log(result.allocation.name);     // e.g. "Aggressive"
console.log(result.allocation.holdings); // [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }]
console.log(result.signals);             // { 'Price_SPY_1_>_SMA_SPY_50_t0': true }
console.log(result.indicators);          // { 'Price_SPY_1': { timestamp: '...', value: 590.5 } }
```

**Evaluation pipeline:**
1. Fetches all required series and resolves the strategy's DB ID in parallel
2. Computes the evaluation date from market close observations
3. Falls back to pure evaluation if no DB record or trading day exists
4. **Cache hit**: reconstructs the result from stored allocation, signal states, and indicator evaluations
5. **Cache miss**: fetches prior signal states (for hysteresis) and indicator metadata (for incremental computation), runs pure evaluation, stores result non-blocking

> Cache writes are fire-and-forget. Store failures are logged to `console.error` but never propagate to the caller.

---

### `stream(strategy, observation)`

Live streaming evaluation. Merges a single incoming observation into historical data and evaluates without caching.

| Parameter     | Type                | Description                      |
|---------------|---------------------|----------------------------------|
| `strategy`    | `Strategy`          | Fully-resolved strategy object   |
| `observation` | `StreamObservation` | Incoming price tick              |

**Returns** `Promise<StrategyEvaluation>`

```ts
const result = await livefolio.strategy.stream(strategy, {
  symbol: 'SPY',
  timestamp: '2025-03-04T19:30:00.000Z',
  value: 592.3,
});
```

**Behavior:**
- Fetches historical series, then merges the observation (replaces same-date bar or appends a new one)
- Fetches prior signal states and indicator metadata from DB for hysteresis
- Runs pure evaluation on the merged series
- Does **not** check or write to the evaluation cache (interim data)

---

### `evaluateIndicator(indicator, options)`

Pure (synchronous) evaluation of a single indicator.

| Parameter   | Type                | Description                |
|-------------|---------------------|----------------------------|
| `indicator` | `Indicator`         | Indicator definition       |
| `options`   | `EvaluationOptions` | Evaluation context         |

**Returns** `IndicatorEvaluation`

```ts
const result = livefolio.strategy.evaluateIndicator(
  { type: 'SMA', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 50, delay: 0, unit: null, threshold: null },
  { at: new Date(), batchSeries: { SPY: [...] } },
);
// { timestamp: '2025-01-10T21:00:00Z', value: 102.4 }
```

See [Indicator Types](#indicator-types) for details on each type.

---

### `evaluateSignal(signal, options)`

Pure evaluation of a signal (comparison of two indicators with optional dead-band hysteresis).

| Parameter | Type                | Description              |
|-----------|---------------------|--------------------------|
| `signal`  | `Signal`            | Signal definition        |
| `options` | `EvaluationOptions` | Evaluation context       |

**Returns** `boolean`

```ts
const isActive = livefolio.strategy.evaluateSignal(
  {
    left: { type: 'Price', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
    comparison: '>',
    right: { type: 'SMA', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 50, delay: 0, unit: null, threshold: null },
    tolerance: 0.02,
  },
  { at: new Date(), batchSeries: { SPY: [...] }, previousSignalStates: { ... } },
);
```

> **Hysteresis:** When `tolerance > 0` and a `previousSignalStates` entry exists, the signal uses sticky boundary logic to prevent churn near threshold crossings.

---

### `evaluateAllocation(allocation, options)`

Pure evaluation of an allocation's condition tree.

| Parameter    | Type                | Description                  |
|--------------|---------------------|------------------------------|
| `allocation` | `Allocation`        | Allocation with condition    |
| `options`    | `EvaluationOptions` | Evaluation context           |

**Returns** `boolean` — whether the allocation's condition is satisfied.

---

### `getEvaluationDate(trading, options)`

Computes the evaluation date based on trading frequency and market close observations.

| Parameter | Type                | Description               |
|-----------|---------------------|---------------------------|
| `trading` | `Trading`           | Frequency + offset        |
| `options` | `EvaluationOptions` | Needs `at` and `batchSeries` |

**Returns** `Date`

> Uses the first series in `batchSeries` to find the latest market-close observation at or before `options.at`. For non-Daily frequencies, computes period bounds and applies `trading.offset` to count back from the period's last bar.

---

### `extractSymbols(strategy)`

Extracts all unique ticker symbols needed to evaluate a strategy.

| Parameter  | Type       | Description              |
|------------|------------|--------------------------|
| `strategy` | `Strategy` | Strategy to analyze      |

**Returns** `string[]` — deduplicated array.

```ts
const symbols = livefolio.strategy.extractSymbols(strategy);
// ['SPY', '^VIX', 'DGS10']
```

> Includes symbols from indicators (resolving macro types via `INDICATOR_SYMBOL_MAP`) and from allocation holdings. `Threshold` indicators contribute no symbol.

---

### `backtest(strategy, options)`

Not yet implemented.

| Parameter  | Type              | Description            |
|------------|-------------------|------------------------|
| `strategy` | `Strategy`        | Strategy to backtest   |
| `options`  | `BacktestOptions` | Start/end date range   |

**Throws** `Error('Not implemented')`.

---

## Types

### `Strategy`

```ts
interface Strategy {
  linkId: string;
  name: string;
  trading: Trading;
  allocations: NamedAllocation[];  // priority order (first match wins)
  signals: NamedSignal[];
}

interface Trading {
  frequency: Frequency;  // 'Daily' | 'Weekly' | 'Monthly' | ...
  offset: number;        // bars from period end to look back (0 = last bar)
}
```

### `NamedSignal` / `NamedAllocation`

```ts
interface NamedSignal {
  name: string;
  signal: Signal;
}

interface NamedAllocation {
  name: string;
  allocation: Allocation;
}
```

### `Signal`

```ts
interface Signal {
  left: Indicator;
  comparison: Comparison;  // '>' | '<' | '='
  right: Indicator;
  tolerance: number;       // dead-band for hysteresis (0 = no hysteresis)
}
```

### `Indicator`

```ts
interface Indicator {
  type: IndicatorType;
  ticker: Ticker;
  lookback: number;
  delay: number;
  unit: Unit;              // '%' | '$' | null
  threshold: number | null;
}

interface Ticker {
  symbol: string;
  leverage: number;
}
```

### `Allocation`

```ts
interface Allocation {
  condition: Condition;
  holdings: Holding[];
}

interface Holding {
  ticker: Ticker;
  weight: number;
}
```

### `Condition`

Boolean expression tree in disjunctive normal form (OR of ANDs):

```ts
type Condition = OrExpr | AndExpr | UnaryExpr;

interface OrExpr  { kind: 'or';  args: AndExpr[]; }
interface AndExpr { kind: 'and'; args: UnaryExpr[]; }

type UnaryExpr = SignalExpr | NotExpr;
interface SignalExpr { kind: 'signal'; signal: Signal; }
interface NotExpr   { kind: 'not';    signal: Signal; }
```

### `EvaluationOptions`

```ts
interface EvaluationOptions {
  at: Date;
  batchSeries: Record<string, Observation[]>;
  previousSignalStates?: Record<string, boolean>;       // for hysteresis
  previousIndicatorMetadata?: Record<string, unknown>;  // for incremental computation
}
```

### `StrategyEvaluation`

```ts
interface StrategyEvaluation {
  asOf: Date;
  allocation: AllocationEvaluation;
  signals: Record<string, boolean>;                // keyed by signalKey()
  indicators: Record<string, IndicatorEvaluation>; // keyed by indicatorKey()
}

interface AllocationEvaluation {
  name: string;
  holdings: Holding[];
}

interface IndicatorEvaluation {
  timestamp: string;
  value: number;
  metadata?: unknown;  // incremental state (EMA, RSI, Drawdown)
}
```

### `StreamObservation`

```ts
interface StreamObservation {
  symbol: string;
  timestamp: string;  // ISO 8601
  value: number;
}
```

---

## Indicator Types

| Type          | Lookback       | Incremental | Description                                              |
|---------------|----------------|-------------|----------------------------------------------------------|
| `SMA`         | `lookback` bars | No         | Simple moving average of prices in window                |
| `EMA`         | Full / 1 bar   | Yes         | Exponential moving average, k = 2/(lookback+1)          |
| `Price`       | 1 bar          | No          | Last closing price                                       |
| `Return`      | `lookback` bars | No         | Percent change from first to last price in window        |
| `Volatility`  | `lookback` bars | No         | Annualized std dev of daily returns (x sqrt(252) x 100)  |
| `Drawdown`    | Full / 1 bar   | Yes         | Absolute percent drawdown from running peak              |
| `RSI`         | Full / 2 bars  | Yes         | Wilder's smoothed RSI (returns 50 when avgGain=avgLoss=0)|
| `VIX`         | 1 bar          | No          | Delegates to Price with `^VIX`                           |
| `VIX3M`       | 1 bar          | No          | Delegates to Price with `^VIX3M`                         |
| `T3M`..`T30Y` | 1 bar         | No          | Delegates to Price with FRED symbols (DGS3MO, DGS1, etc)|
| `Month`       | -              | No          | UTC month (1-12), adjusted by delay days                 |
| `Day of Week` | -              | No          | UTC day of week (0=Sun), adjusted by delay days          |
| `Day of Month`| -              | No          | UTC day of month (1-31), adjusted by delay days          |
| `Day of Year` | -              | No          | Day of year (1-366), adjusted by delay days              |
| `Threshold`   | -              | No          | Returns `indicator.threshold` directly (constant)        |

**Incremental indicators** (`EMA`, `Drawdown`, `RSI`) use `previousIndicatorMetadata` to avoid full-series recomputation. The metadata is stored in `indicator_evaluations.metadata` and fed back via `EvaluationOptions`.

**Leverage:** When `ticker.leverage !== 1`, the series is transformed by simulating compounded daily returns scaled by the leverage factor.

---

## Key Behavior

### Signal Hysteresis

When `tolerance > 0` and a prior signal state exists in `previousSignalStates`, signals use dead-band logic:

- A **true** signal stays true until the left indicator fully exits the tolerance band
- A **false** signal stays false until the left indicator fully crosses beyond the band

This prevents signal churn near threshold crossings.

### Evaluation Priority

Allocations are evaluated in array order (priority order). The **first** allocation whose condition evaluates to `true` wins. The **last** allocation should always have a trivially-true condition (e.g. `Threshold(1) > Threshold(0)`) as the fallback.

### Dictionary Keys

Results are keyed by deterministic string keys:

- **`indicatorKey`**: `Price_SPY_1`, `SMA_SPY_50`, `Threshold_0.5`, `SMA_SPY_50_d2` (with delay)
- **`signalKey`**: `Price_SPY_1_>_SMA_SPY_50_t0` (includes tolerance)
