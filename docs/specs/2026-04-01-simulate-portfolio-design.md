# Simulate with PortfolioHandle Design

## Overview

Replace `initialCapital: number` with `portfolio: PortfolioHandle` across the simulation API so backtests can start from existing positions instead of only all-cash.

## Motivation

The simulation engine currently starts every backtest from a cash-only state via `initialCapital`. With `PortfolioHandle` now in the SDK, we can let callers specify "I already hold these positions" and simulate a strategy from that starting point. Starting from all-cash is just a degenerate case: `client.portfolio([cashx, amount])`.

## Changes

### SimulateOptions

```ts
// backtest/types.ts
interface SimulateOptions {
  from: string;
  to: string;
  portfolio: PortfolioHandle;  // required, replaces initialCapital
}
```

`initialCapital` is removed entirely. `portfolio` is required with no default.

### SimulationHandle

```ts
// backtest/types.ts
class SimulationHandle {
  readonly series: DailyBar[];
  readonly trades: Trade[];
  readonly startingPortfolio: PortfolioHandle;  // replaces initialCapital
}
```

Callers who need the initial dollar value can call `startingPortfolio.value(prices)`.

### runSimulation

```ts
// backtest/simulate.ts
function runSimulation(
  bars: StrategyBar[],
  prices: Record<string, Record<string, number>>,
  rebalanceDates: Set<string>,
  portfolio: PortfolioHandle,
): { series: DailyBar[]; trades: Trade[] }
```

**Seeding:** Extract `positions` and `cash` from portfolio holdings:
- CASHX holdings → `cash`
- All other holdings → `positions[symbol] = quantity`

The rest of the simulation loop is unchanged — it already handles non-empty `positions` and `cash`.

### StrategyHandle.simulate

```ts
// handles/strategy.ts
async simulate(options: SimulateOptions): Promise<SimulationHandle> {
  const bars = await this.series({ from: options.from, to: options.to });
  if (bars.length === 0) {
    return new SimulationHandle([], [], options.portfolio);
  }

  const prices = await this._fetchPricesForTickers(bars, options.from, options.to);
  const tradingDays = bars.map((b) => b.date);
  const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);

  // Force day 1 rebalance so existing positions align to strategy
  rebalanceDates.add(bars[0].date);

  const result = runSimulation(bars, prices, rebalanceDates, options.portfolio);
  return new SimulationHandle(result.series, result.trades, options.portfolio);
}
```

The only new line is `rebalanceDates.add(bars[0].date)` — forces the first day as a rebalance date so existing positions immediately trade into the strategy's target allocation.

## Day 1 Forced Rebalance

When starting with existing positions, the simulation forces a rebalance on the first bar's date. This ensures the portfolio aligns to the strategy's target allocation immediately, regardless of the strategy's rebalance frequency. Without this, a monthly strategy starting mid-month would let misaligned positions ride for weeks.

This is added in `StrategyHandle.simulate` (not in `runSimulation`) because it's a policy decision about how strategies handle initial alignment — `runSimulation` just executes whatever rebalance dates it's given.

## Existing Test Updates

All tests in `simulate.test.ts` and `strategy-simulate.test.ts` that use `initialCapital` must be updated to construct a cash-only `PortfolioHandle`:

```ts
// Before:
runSimulation(bars, prices, rebalanceDates, 100_000)

// After:
const cashx = new TickerHandle(sb, 'CASHX');
const portfolio = new PortfolioHandle([[cashx, 100_000]]);
runSimulation(bars, prices, rebalanceDates, portfolio)
```

## New Test: Starting with Existing Positions

At least one new test in `simulate.test.ts` should verify:
- Portfolio with non-cash holdings is correctly seeded (positions and cash extracted)
- Day 1 rebalance trades from existing positions into the strategy's target allocation
- The resulting trades reflect the delta between starting positions and target allocation (not a full buy from cash)

## File Changes

| File | Change |
|------|--------|
| `sdk/src/backtest/types.ts` | `SimulateOptions`: remove `initialCapital`, add `portfolio`. `SimulationHandle`: `initialCapital` → `startingPortfolio` |
| `sdk/src/backtest/simulate.ts` | `runSimulation`: accept `PortfolioHandle`, seed positions/cash from holdings |
| `sdk/src/handles/strategy.ts` | `simulate()`: pass portfolio, force day 1 rebalance |
| `sdk/src/backtest/simulate.test.ts` | Update existing tests, add new position-seeded test |
| `sdk/src/handles/strategy-simulate.test.ts` | Update existing tests to use portfolio |

## Non-Goals

- Adding `PortfolioHandle` to `SimulationHandle` output at intermediate dates (future work)
- Tax-lot tracking or position-level P&L
- Multiple portfolio support or portfolio comparison
