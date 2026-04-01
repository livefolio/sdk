<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-04-01 | Updated: 2026-04-01 -->

# backtest

## Purpose
Portfolio backtesting simulation engine. Takes a strategy's daily allocation series, historical prices, and a starting portfolio, then simulates trading over time to produce a portfolio value series and trade log.

## Key Files

| File | Description |
|------|-------------|
| `index.ts` | Barrel export for simulation types and runner |
| `types.ts` | `SimulationHandle`, `SimulateOptions`, `Trade` — simulation result and config types |
| `simulate.ts` | `runSimulation()` — Core simulation loop: iterates days, rebalances on schedule, tracks positions |

## Test Files

| File | Tests |
|------|-------|
| `simulate.test.ts` | Simulation correctness — rebalancing, trade generation, portfolio value tracking |

## For AI Agents

### Working In This Directory
- `runSimulation()` is a pure function: no database calls, takes pre-fetched data
- The simulation loop: for each trading day, rebalance if scheduled, then compute end-of-day portfolio value
- `SimulationHandle` is a simple result container (series + trades + starting portfolio)
- `StrategyHandle.simulate()` is the entry point — it fetches prices, computes rebalance dates, then calls `runSimulation()`

### Simulation Flow
```
StrategyHandle.simulate(options)
  → fetch strategy bars (date → allocation)
  → fetch prices for all referenced tickers
  → compute rebalance dates from frequency
  → runSimulation(bars, prices, rebalanceDates, portfolio)
      → for each day:
          if rebalance day: compute target shares from allocation weights, execute trades
          compute portfolio value = cash + sum(shares * price)
      → return { series: DailyBar[], trades: Trade[] }
```

### Testing Requirements
- Test rebalancing produces correct trades (sells before buys)
- Test portfolio value tracks correctly across non-rebalance days
- Test CASHX handling (price always 1)
- Test starting from existing positions (non-empty portfolio)

### Common Patterns
- `EPSILON = 1e-8` threshold for floating-point comparisons
- Cash is tracked separately from equity positions
- Trades are recorded with absolute quantities and buy/sell action

## Dependencies

### Internal
- `../handles/indicator.js` — `DailyBar` type
- `../handles/strategy.js` — `StrategyBar` type
- `../handles/portfolio.js` — `PortfolioHandle` class

### External
- None — pure computation

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
