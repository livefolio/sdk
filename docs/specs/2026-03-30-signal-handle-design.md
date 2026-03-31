# Signal Handle — Lazy Signals with Hysteresis

## Overview

Add `SignalHandle` to the SDK following the same lazy handle pattern as tickers and indicators. Signals compare two indicators using `>`, `<`, or `=` with a tolerance parameter that implements hysteresis to reduce whipsawing. Factory methods `sdk.gt()`, `sdk.lt()`, `sdk.eq()` create signal handles.

## SignalHandle

```ts
const spy = sdk.ticker('SPY')
const price = sdk.price(spy)
const sma200 = sdk.sma(spy, 200)

const bullish = sdk.gt(price, sma200)        // tolerance defaults to 0
const bearish = sdk.lt(price, sma200, 5)     // 5% tolerance with hysteresis
const flat = sdk.eq(price, sma200, 1)
```

Stores `{ indicator1: IndicatorHandle, indicator2: IndicatorHandle, comparison: '>' | '<' | '=', tolerance: number }`. Lazy — no DB call until `.series()` or `.value()`.

**Public API:**
- `resolve()` — upserts the signal row (resolves both indicators first to get their IDs)
- `series(range?)` — returns `DailyBar[]` with value `0` or `1`
- `value(date?)` — returns `0`, `1`, or `null`
- `id` — getter, throws if unresolved

Uses the same `_resolving` promise pattern as TickerHandle and IndicatorHandle to prevent concurrent resolution races.

## Sync

When `signal.series()` is called:

1. Ensure both indicators are fresh (calls `_ensureFresh()` on each — this triggers indicator sync if needed)
2. Check signal series freshness (same pattern as indicators — compare latest `signals_series` date to latest closed trading day)
3. If stale:
   - Read both indicator series from DB
   - Read the last known signal value from DB (for hysteresis continuity)
   - Compute new signal values using hysteresis
   - Upsert to `signals_series`
4. Query `signals_series` and return
5. Cache in-memory on the handle (same immutable-after-close caching as indicators)

## Hysteresis Computation

Pure function in `src/computations/signal.ts`:

```ts
function evaluateSignal(
  series1: DailyBar[],
  series2: DailyBar[],
  comparison: '>' | '<' | '=',
  tolerance: number,
  absolute: boolean,
  previousValue?: number,
): DailyBar[]
```

### Tolerance modes

Determined by indicator_1's type:
- **Absolute** (tolerance added/subtracted directly): Return, Volatility, Drawdown, VIX, VIX3M, Treasury rates (T3M through T30Y)
- **Relative** (tolerance is percentage of indicator_2's value): Price, SMA, EMA, RSI, Threshold, Calendar

### Buffer computation

For a given indicator_2 value `v` and tolerance `t`:
- Relative: `upperBuffer = v * (1 + t/100)`, `lowerBuffer = v * (1 - t/100)`
- Absolute: `upperBuffer = v + t`, `lowerBuffer = v - t`

### Evaluation logic (comparison `>`)

- Previous signal was `0` (false): flip to `1` only if `ind1 > upperBuffer`
- Previous signal was `1` (true): flip to `0` only if `ind1 < lowerBuffer`
- While in the buffer zone, carry forward the previous value
- First evaluation (no previous value): raw comparison without buffer (`ind1 > ind2`)

### Evaluation logic (comparison `<`)

Mirror of `>`:
- Previous signal was `0` (false): flip to `1` only if `ind1 < lowerBuffer`
- Previous signal was `1` (true): flip to `0` only if `ind1 > upperBuffer`

### Evaluation logic (comparison `=`)

- Signal is `1` when `ind1` is within the buffer zone: `lowerBuffer <= ind1 <= upperBuffer`
- Signal is `0` otherwise
- No hysteresis for `=` — it's a range check, not a state-dependent flip

### When tolerance is 0

No buffer zone — raw comparison on every bar. No hysteresis.

### Incremental computation

When syncing incrementally (fromDate is set), the function receives the last known signal value from the DB as `previousValue` to maintain hysteresis continuity across sync boundaries.

## File Structure

```
sdk/src/
  handles/
    signal.ts            # SignalHandle class
    indicator.ts         # unchanged
    ticker.ts            # unchanged
    index.ts             # add SignalHandle export
  computations/
    signal.ts            # evaluateSignal() pure function
    ...                  # existing files unchanged
  client.ts              # add gt(), lt(), eq() factory methods
  index.ts               # add SignalHandle export
```

## Client Factories

```ts
export interface LivefolioClient {
  // ...existing methods...

  gt(ind1: IndicatorHandle, ind2: IndicatorHandle, tolerance?: number): SignalHandle;
  lt(ind1: IndicatorHandle, ind2: IndicatorHandle, tolerance?: number): SignalHandle;
  eq(ind1: IndicatorHandle, ind2: IndicatorHandle, tolerance?: number): SignalHandle;
}
```

Tolerance defaults to `0`. The DB comparison enum is `'>' | '<' | '='`, which the factories map directly.

## Design Decisions

**Factory methods over handle methods:** `sdk.gt(price, sma200)` keeps signal creation on the SDK client, consistent with indicator factories. Avoids circular dependency between IndicatorHandle and SignalHandle.

**DailyBar with 0/1 over boolean:** Consistent return type across all handles. Composable with the same tooling.

**Hysteresis as a pure computation:** `evaluateSignal()` is a stateless function (previous value passed as argument). Easy to test with known inputs/outputs. The handle manages state (reading previous value from DB).

**Absolute vs relative determined by indicator_1 type:** Matches testfolio's behavior exactly. Percent-based indicators (Return, Volatility, etc.) use absolute tolerance; price-based indicators use relative.
