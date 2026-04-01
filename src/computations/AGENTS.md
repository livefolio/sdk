<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-04-01 -->

# computations

## Purpose
Pure functions that compute technical indicators and strategy evaluation logic. These operate on `DailyBar[]` arrays and have no database dependencies — they are called by handles during sync.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel export + `getComputation()` dispatcher mapping indicator types to functions |
| `sma.ts` | `computeSma()` — Simple Moving Average |
| `ema.ts` | `computeEma()` — Exponential Moving Average |
| `rsi.ts` | `computeRsi()` — Relative Strength Index |
| `returns.ts` | `computeReturns()` — Period returns |
| `volatility.ts` | `computeVolatility()` — Rolling volatility |
| `drawdown.ts` | `computeDrawdown()` — Drawdown from peak |
| `calendar.ts` | `computeCalendar()` — Calendar-based indicators (month, day of week, etc.) |
| `signal.ts` | `evaluateSignal()` — Compares two indicator series with gt/lt/eq and tolerance |
| `strategy.ts` | `evaluateStrategy()` + `computeRebalanceDates()` — Strategy rule evaluation engine |

## Test Files

| File | Tests |
|------|-------|
| `computations.test.ts` | Unit tests for SMA, EMA, RSI, returns, volatility, drawdown |
| `signal.test.ts` | Signal comparison logic with tolerance edge cases |
| `strategy.test.ts` | Strategy evaluation and rebalance date computation |

## For AI Agents

### Working In This Directory
- All computation functions are pure: `(bars: DailyBar[], lookback: number) => DailyBar[]`
- `DailyBar` is `{ date: string; value: number }` — defined in `../handles/indicator.ts`
- `getComputation()` returns `null` for types that aren't computed (Price, VIX, etc.)
- `evaluateStrategy()` uses a first-match rule engine: iterate rules top-down, first with all signals true wins
- `computeRebalanceDates()` supports Daily, Weekly, Monthly, Quarterly, Yearly frequencies with offset

### Testing Requirements
- Computation tests should verify edge cases: empty arrays, lookback > array length, NaN values
- Strategy tests should cover rule priority (first match wins) and fallback rules

### Common Patterns
- Functions consume and produce `DailyBar[]` for composability
- Lookback period means the first N results may be omitted or have reduced accuracy

## Dependencies

### Internal
- `../handles/indicator.js` — `DailyBar` type
- `../database.types.js` — `indicator_type` enum

### External
- None — pure computation, no external dependencies

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
