# Simulation Design Specification

**Date:** 2026-03-31
**Status:** Draft

## Overview

Add a `simulate()` method to StrategyHandle that runs a portfolio simulation over a date range and returns a `SimulationHandle` — a lightweight result object exposing the equity curve as `DailyBar[]`, trade history, and initial capital. No built-in metric getters; agents compute whatever derived metrics they need (CAGR, Sharpe, drawdown, etc.) from the raw data.

## Public API

```typescript
const sim = await strategy.simulate({ from: '2020-01-01', to: '2025-12-31', initialCapital: 100_000 });

sim.series         // DailyBar[] — portfolio value per trading day
sim.trades         // Trade[]   — every buy/sell event (date, symbol, quantity, price, action)
sim.initialCapital // number    — starting capital (default 100,000)
```

### Usage Example

```typescript
const spy = sdk.ticker('SPY');
const shy = sdk.ticker('SHY');
const price = sdk.price(spy);
const sma200 = sdk.sma(spy, 200);
const bullish = sdk.gt(price, sma200, 5);

const strategy = sdk.strategy({
  name: 'Tactical SPY/SHY',
  freq: 'Monthly',
  rules: [
    { when: [bullish], hold: sdk.allocation([spy, 1.0]) },
    { hold: sdk.allocation([shy, 1.0]) },
  ],
});

const sim = await strategy.simulate({ from: '2020-01-01', to: '2025-12-31' });

// Agents compute whatever they want from the raw data
const values = sim.series.map(b => b.value);
const dailyReturns = values.slice(1).map((v, i) => (v - values[i]) / values[i]);
// CAGR, Sharpe, drawdown, etc. — agent's choice
```

## Types

```typescript
interface SimulateOptions {
  from: string;              // YYYY-MM-DD
  to: string;                // YYYY-MM-DD
  initialCapital?: number;   // default: 100,000
}

interface Trade {
  date: string;
  symbol: string;
  quantity: number;          // number of shares traded (always positive)
  price: number;
  action: 'buy' | 'sell';
}

class SimulationHandle {
  readonly series: DailyBar[];       // portfolio value per trading day
  readonly trades: Trade[];          // all executed trades
  readonly initialCapital: number;   // starting capital
}
```

`DailyBar` is the existing `{ date: string; value: number }` from `handles/indicator.ts`.

## SimulationHandle

A purely computed result object. No database persistence, no `resolve()`, no caching to a table. Constructed by `StrategyHandle.simulate()` and returned directly.

Not a "handle" in the resolve/sync sense — it's a handle only by naming convention, holding simulation results for the caller.

### Future Extensibility

New data fields (cash breakdown, per-allocation tracking, tax lots, benchmark comparison) can be added to `SimulationHandle` without breaking existing consumers. The raw data fields are the stable API; agents derive whatever metrics they need.

## StrategyHandle.simulate() Method

```typescript
class StrategyHandle {
  // ... existing methods ...

  async simulate(options: SimulateOptions): Promise<SimulationHandle>;
}
```

### Internal Flow

1. **Get strategy series** — `this.series({ from, to })` returns `StrategyBar[]` (allocation per trading day). This triggers the full sync chain (indicators, signals, strategy evaluation).
2. **Extract tickers** — collect all unique ticker symbols from all `AllocationHandle.holdings` across all bars.
3. **Fetch price series** — for each ticker, get the price `DailyBar[]` over the date range via the SDK's existing price indicator mechanism.
4. **Compute rebalance dates** — `computeRebalanceDates(tradingDays, this.freq, this.offset)` (existing function in `computations/strategy.ts`).
5. **Run pure simulation** — call the internal `runSimulation()` pure function with strategy bars, price map, rebalance dates, and initial capital.
6. **Return SimulationHandle** — wrap the results.

## Pure Simulation Function

```typescript
// backtest/simulate.ts — internal, exported for testing only

function runSimulation(
  bars: StrategyBar[],
  prices: Record<string, Record<string, number>>,   // symbol -> date -> price
  rebalanceDates: Set<string>,
  initialCapital: number,
): { series: DailyBar[]; trades: Trade[] }
```

This is a synchronous, pure function with no DB access. All data is pre-fetched by `StrategyHandle.simulate()`.

### Simulation Logic

State tracked across trading days:
- `positions: Record<string, number>` — symbol -> shares held
- `cash: number` — uninvested cash
- `trades: Trade[]` — accumulated trade log

**For each trading day in `bars`:**

1. **Look up prices** for all currently held positions and all positions in the day's target allocation.
2. **Compute portfolio value** — `cash + sum(shares[symbol] * price[symbol])`.
3. **If rebalance date:**
   a. Determine target allocation from the day's `StrategyBar.allocation.holdings` (ticker + weight pairs).
   b. Compute target shares for each position: `targetValue = portfolioValue * weight`, `targetShares = targetValue / price`.
   c. For each position, compute delta: `target - current`.
   d. Execute trades for non-zero deltas. Record each trade. Update positions and cash.
4. **Record** the day's portfolio value as a `DailyBar`.

### Rebalancing

Calendar-only rebalancing, following the strategy's `trading_freq` and `offset`. Uses the existing `computeRebalanceDates()` function from `computations/strategy.ts`.

On rebalance dates, the portfolio is rebalanced to match the target allocation weights exactly. Positions not in the target allocation are fully sold. New positions are bought to target weight.

### Leverage

Handled upstream. The price series for a leveraged ticker (e.g., `ticker('SPY', 3)`) already reflects leveraged returns via the SDK's existing indicator/provider layer. The simulator consumes prices as-is.

### Edge Cases

- **First trading day:** Always rebalance (initial investment from cash to target allocation).
- **Missing price for a symbol on a given day:** Skip that symbol's trade for the day; hold existing position. Log a warning.
- **Zero portfolio value:** Should not occur with positive initial capital and valid price data.
- **Allocation weights don't sum to 1.0:** AllocationHandle already validates this at construction time.

## Tax Accounting (Deferred)

Full HIFO lot selection and wash-sale rule tracking are deferred to a future iteration. When added, the simulation engine will track:
- Individual tax lots per position (cost basis, acquisition date)
- HIFO (Highest In, First Out) lot selection on sells
- Wash-sale rule disallowance (-30 to +30 days)
- Annual short-term vs long-term realized gains

This will add an `annualTax` field to `SimulationHandle`. The pure simulation function already executes trades in the right order to support lot tracking — adding tax is an incremental change, not a redesign.

## File Structure

### New Files
- `sdk/src/backtest/simulate.ts` — `runSimulation()` pure function
- `sdk/src/backtest/simulate.test.ts` — simulation logic tests
- `sdk/src/backtest/types.ts` — `SimulateOptions`, `Trade`, `SimulationHandle`
- `sdk/src/backtest/index.ts` — barrel export

### Modified Files
- `sdk/src/handles/strategy.ts` — add `simulate()` method
- `sdk/src/handles/strategy.test.ts` — add simulation tests
- `sdk/src/index.ts` — export `SimulationHandle`, `SimulateOptions`, `Trade`

### No New Dependencies

## Design Decisions

1. **`simulate()` on StrategyHandle, not standalone** — the strategy has everything needed (series, freq, offset, tickers). No reason to require the caller to assemble inputs.
2. **SimulationHandle is purely computed** — no DB persistence. Can be added later if caching simulation results becomes valuable.
3. **No built-in metrics** — agents compute CAGR, Sharpe, etc. from the raw `series` and `trades` data. This gives agents and users full control over what they compute.
4. **DailyBar for equity curve** — consistent with existing `indicator.series()` and `signal.series()` return types.
5. **Calendar rebalancing only** — follows strategy's `trading_freq`. Drift and on-change modes deferred.
6. **Tax accounting deferred** — HIFO + wash-sale logic is well-understood (ported from old livefolio) but adds complexity. Ship the equity curve and trades first.
7. **Leverage upstream** — simulator consumes pre-leveraged prices. No leverage logic in the simulation engine.
8. **Pure internal function** — `runSimulation()` is synchronous and pure for testability. `StrategyHandle.simulate()` handles all data fetching.
