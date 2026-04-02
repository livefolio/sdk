# Live Price Push Design Specification

**Date:** 2026-04-01
**Status:** Draft

## Overview

Add a `.push()` method to `SimulationHandle` that accepts live market prices and returns a real-time portfolio snapshot. This enables consumers to extend a historical backtest with live websocket data, producing a continuously updating "what if the market closed right now" valuation without re-running the full simulation.

The SDK is feed-agnostic — consumers own the websocket connection and push raw market prices into the SDK. The SDK handles leverage scaling, portfolio valuation, and trade previewing internally.

## Public API

```typescript
const sim = await strategy.simulate({ from: '2020-01-01', to: '2025-12-31', portfolio });

// Push live market prices (raw, unleveraged) — rest args of [TickerHandle, number] tuples
const snapshot = sim.push([spy, 502.30], [tlt, 98.10]);

snapshot.value          // number — total portfolio value at these prices
snapshot.holdings       // [TickerHandle, number][] — current positions (ticker, quantity)
snapshot.weights        // [TickerHandle, number][] — current weights (ticker, weight)
snapshot.pendingTrades  // Trade[] — trades that WOULD execute if this were a rebalance

// Push again as prices update — only updated symbols needed
const snapshot2 = sim.push([spy, 503.00]);
// TLT retains its last pushed price (or historical close if never pushed)
```

### Usage Example

```typescript
const spy = sdk.ticker('SPY');
const tlt = sdk.ticker('TLT');

// Historical backtest
const sim = await strategy.simulate({ from: '2020-01-01', to: '2025-12-31', portfolio });

// Consumer's equity curve starts with historical data
const equityCurve = [...sim.series];

// Consumer connects to their own websocket feed
ws.on('message', (tick) => {
  const snapshot = sim.push([spy, tick.SPY], [tlt, tick.TLT]);

  // Consumer builds live equity curve from snapshots
  equityCurve.push({ date: new Date().toISOString(), value: snapshot.value });

  // Consumer can preview upcoming rebalance trades
  console.log('Pending trades:', snapshot.pendingTrades);
});
```

## Types

```typescript
interface PortfolioSnapshot {
  value: number;                        // total portfolio value
  holdings: [TickerHandle, number][];   // current positions (ticker, quantity)
  weights: [TickerHandle, number][];    // current weights (ticker, weight)
  pendingTrades: Trade[];               // trades that WOULD execute if this were a rebalance
}
```

`Trade` is the existing `{ date, symbol, quantity, price, action }` from `backtest/types.ts`.

## SimulationHandle Changes

### New Internal State

```typescript
class SimulationHandle {
  // Existing (unchanged)
  readonly series: DailyBar[];
  readonly trades: Trade[];
  readonly startingPortfolio: PortfolioHandle;

  // New — initialized from runSimulation() finalState
  private _portfolio: PortfolioHandle;              // final positions including CASHX
  private _currentAllocation: AllocationHandle;     // last bar's target allocation
  private _lastClosePrices: Record<string, number>; // symbol → real market close (unleveraged)
  private _lastLeveragedPrices: Map<string, number>;    // symbol:leverage → leveraged price at close
  private _currentLeveragedPrices: Map<string, number>; // symbol:leverage → live leveraged price
}
```

### Constructor Changes

The constructor gains an additional `finalState` parameter:

```typescript
constructor(
  series: DailyBar[],
  trades: Trade[],
  startingPortfolio: PortfolioHandle,
  finalState?: {
    portfolio: PortfolioHandle;
    allocation: AllocationHandle;
    closePrices: Record<string, number>;
    leveragedPrices: Record<string, number>; // "symbol:leverage" → price
  },
)
```

`finalState` is optional for backward compatibility (empty simulations pass no final state).

### `.push()` Method

```typescript
push(...prices: [TickerHandle, number][]): PortfolioSnapshot
```

**Algorithm:**

1. For each incoming `[ticker, realPrice]`:
   - Skip if `ticker.symbol === 'CASHX'`
   - Skip if `ticker.symbol` not in `_lastClosePrices` (unknown symbol)
   - Compute `realReturn = (realPrice - _lastClosePrices[symbol]) / _lastClosePrices[symbol]`
2. For each leveraged ticker in the portfolio that shares that symbol:
   - `leveragedReturn = ticker.leverage * realReturn`
   - `newLeveragedPrice = _lastLeveragedPrices[key] * (1 + leveragedReturn)`
   - Update `_currentLeveragedPrices[key] = newLeveragedPrice`
3. Build `[TickerHandle, number][]` price array from `_currentLeveragedPrices`
4. Delegate to `_portfolio`:
   - `value = _portfolio.value(priceArray)`
   - `weights = _portfolio.weights(priceArray)`
   - `holdings = _portfolio.holdings` (positions unchanged)
   - `pendingTrades = _portfolio.trades(_currentAllocation, priceArray, lastDate)`
5. Return `PortfolioSnapshot`

**Key:** Leveraged returns are always computed from the historical close, not from previous pushes. Pushing `[spy, 502]` then `[spy, 504]` both use the original close as the base — no compounding errors.

## runSimulation() Changes

The pure `runSimulation()` function additionally returns the final portfolio:

```typescript
interface SimulationResult {
  series: DailyBar[];
  trades: Trade[];
  finalPortfolio: PortfolioHandle;  // final positions (shares per ticker) + remaining cash as CASHX
}
```

`runSimulation()` stays pure and synchronous — it just returns one additional field. The `finalPortfolio` is a `PortfolioHandle` constructed from the loop's final `positions` and `cash` state.

## StrategyHandle.simulate() Changes

`StrategyHandle.simulate()` is responsible for assembling the full `finalState` passed to `SimulationHandle`. It has access to all the data needed:

- `finalPortfolio` — from `runSimulation()` result
- `allocation` — the last bar's `.allocation`
- `leveragedPrices` — the existing prices map from `_fetchPricesForTickers()` already has these (leverage is baked in by `IndicatorHandle`). Extract the last day's value per symbol and re-key as `"symbol:leverage"`. **Note:** `_fetchPricesForTickers()` currently deduplicates by plain symbol (`tickerMap.has(ticker.symbol)`), so a strategy cannot hold both `SPY:1` and `SPY:2`. This is a pre-existing limitation, not introduced by this design.
- `closePrices` — raw (unleveraged) market prices on the last day. These are **not** available from `_fetchPricesForTickers()` because `IndicatorHandle` applies leverage before returning. `simulate()` fetches raw prices separately by creating `leverage: 1` `IndicatorHandle`s for each unique symbol and reading the last day's value. This is a small additional fetch (one price per symbol, last day only).

**Why leverage is applied in IndicatorHandle, not runSimulation():** The indicator layer (`src/handles/indicator.ts:259-268`) transforms raw bars into leveraged bars using `prev * (1 + leverage * dailyReturn)`. By the time prices reach `_fetchPricesForTickers()` and `runSimulation()`, they are already leveraged. The simulation engine treats them as plain prices — it has no concept of leverage.

**Why we need both:** `.push()` receives raw market prices from the consumer. To compute the leveraged return, it needs: (1) the raw close to compute the real return, and (2) the leveraged close to apply the scaled return to. These are different values when `leverage != 1`.

## Leverage Handling

The consumer always pushes raw market prices. The SDK applies leverage internally:

1. **Historical series** — leverage is baked into price data upstream (indicator/provider layer)
2. **Live push** — the SDK computes the real return from the raw price vs. last close, then scales by leverage factor

Example with `SPY:2` (2x leveraged SPY):
- Historical close: SPY real price = $500, leveraged price = $1000 (hypothetical)
- Consumer pushes: `[spy, 502]` (real price, +0.4%)
- SDK computes: leveraged return = 2 × 0.4% = +0.8%
- New leveraged price: $1000 × 1.008 = $1008
- Portfolio valued using $1008 for the `SPY:2` position

## Edge Cases

| Case | Behavior |
|------|----------|
| Push symbol not in portfolio | Ignored silently |
| Partial tick (only some symbols) | Missing symbols retain last known price |
| CASHX in push args | Ignored (cash is always $1) |
| Same price as last close | Snapshot matches final historical state (return = 0) |
| `.push()` before any simulation data | Returns empty snapshot (empty series → no finalState) |
| Multiple pushes | Each computes from historical close, not previous push |

## What Changes

### Modified Files
- `src/backtest/types.ts` — add `PortfolioSnapshot` interface, update `SimulationHandle` class with `.push()` method and private state
- `src/backtest/simulate.ts` — `runSimulation()` additionally returns `finalPortfolio`
- `src/handles/strategy.ts` — `simulate()` fetches raw close prices, extracts leveraged prices from last day, assembles `finalState` and passes to `SimulationHandle` constructor

### New Tests
- `src/backtest/simulate.test.ts` — test `finalState` extraction from `runSimulation()`
- `src/backtest/types.test.ts` — test `.push()` method on `SimulationHandle` (valuation, leverage, partial ticks, edge cases)

### No New Files
### No New Dependencies

## Design Decisions

1. **`.push()` on SimulationHandle, not a separate object** — keeps the API surface minimal. One object to work with after `simulate()`.
2. **Consumer builds live equity curve** — the SDK returns snapshots, the consumer decides what to accumulate. `series` and `trades` stay immutable as the historical record.
3. **Leverage computed from historical close** — avoids compounding errors from tick-to-tick leverage. Each push is independent.
4. **Feed-agnostic** — the SDK accepts `[TickerHandle, number]` tuples. No opinions about websocket providers, tick formats, or connection management.
5. **`PortfolioHandle` reuse** — final simulation state stored as a `PortfolioHandle`, delegating valuation/weights/trades to existing methods.
6. **`pendingTrades` as preview** — shows what would happen at rebalance without executing. Positions only change on the next `simulate()` run.
7. **Rest args for tuples** — `sim.push([spy, 502], [tlt, 98])` matches the SDK's existing tuple patterns (e.g., `AllocationHandle` holdings, `PortfolioHandle` prices).
