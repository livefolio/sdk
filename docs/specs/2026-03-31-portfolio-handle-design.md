# Portfolio Handle Design

## Overview

A new `PortfolioHandle` in the SDK that represents a point-in-time portfolio snapshot (positions + cash) and computes the concrete trades needed to reach a target allocation.

## Motivation

The SDK can model target allocations (`AllocationHandle`) and simulate strategies over time, but has no way to answer: "Given what I actually hold right now, what trades do I need to execute to reach this target?" This feature bridges the gap between strategy output and trade execution.

## PortfolioHandle

### Construction

```ts
const portfolio = client.portfolio([spy, 500], [bnd, 200], [cashx, 5000]);
```

- **Input:** `[TickerHandle, number][]` tuples where the number is share quantity
- **CASHX** is the reserved ticker symbol for cash — quantity is dollar amount
- **No Supabase dependency** — portfolios are ephemeral snapshots, not persisted to the database
- **No `resolve()` method** — nothing to store

### Validation

- Duplicate tickers: throw
- Negative quantities: throw

## Methods

### `value(prices)`

```ts
portfolio.value(prices: [TickerHandle, number][]): number
```

Returns total portfolio dollar value. For each holding: `quantity * price`. CASHX price is always 1.0 (ignored if provided in prices). Throws if a non-CASHX ticker is missing from prices.

### `weights(prices)`

```ts
portfolio.weights(prices: [TickerHandle, number][]): [TickerHandle, number][]
```

Returns current allocation weights as `[TickerHandle, number][]` tuples (same format as `AllocationHandle.holdings`). Each weight = `(quantity * price) / totalValue`. Useful for comparing current state against a target allocation.

### `trades(target, prices, date)`

```ts
portfolio.trades(
  target: AllocationHandle,
  prices: [TickerHandle, number][],
  date: string,
): Trade[]
```

Computes the trades needed to move from the current portfolio to the target allocation. Returns the existing `Trade` type from `backtest/types.ts`.

**Algorithm:**

1. Compute total portfolio value via `value(prices)`
2. For each ticker in target allocation: `targetDollars = totalValue * weight`
3. For each ticker in current portfolio: `currentDollars = quantity * price`
4. Delta = `targetDollars - currentDollars` — positive means buy, negative means sell
5. Convert dollar delta to share quantity: `delta / price`
6. Tickers in current portfolio but not in target: sell entire position
7. CASHX is never emitted as a trade — it is the residual cash absorber

**Output ordering:** Sells first, then buys. Within each group, order is unspecified.

**Fractional shares:** Supported. Exact quantities to hit target weights precisely.

**Validation:** Throws if any non-CASHX ticker (from either the portfolio or the target allocation) is missing from prices.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Ticker in portfolio but not in target | Sell entire position |
| Ticker in target but not in portfolio | Buy from available value |
| CASHX in target allocation | Respected as target weight — that portion stays as cash |
| CASHX not in target allocation | All value allocated to non-cash tickers |
| Portfolio already at target weights | Returns empty `Trade[]` |
| Zero-quantity holdings | Skipped — no trade emitted |

## Client Integration

```ts
// LivefolioClient interface addition
portfolio(...holdings: [TickerHandle, number][]): PortfolioHandle;

// createClient() implementation
portfolio: (...holdings) => new PortfolioHandle(holdings),
```

## Exports

`PortfolioHandle` exported from `sdk/src/index.ts` alongside other handles.

## File Structure

| File | Purpose |
|------|---------|
| `sdk/src/handles/portfolio.ts` | PortfolioHandle class |
| `sdk/src/client.ts` | Add `portfolio()` to interface and factory |
| `sdk/src/handles/index.ts` | Re-export PortfolioHandle |
| `sdk/src/index.ts` | Public export |

## Usage Example

```ts
const lf = createClient({ supabase });

const spy = lf.ticker('SPY');
const bnd = lf.ticker('BND');
const cashx = lf.ticker('CASHX');

// Current state
const portfolio = lf.portfolio([spy, 500], [bnd, 200], [cashx, 5000]);

// Target: 70/30
const target = lf.allocation([spy, 0.7], [bnd, 0.3]);

// Prices
const prices: [TickerHandle, number][] = [[spy, 520.50], [bnd, 72.30]];

// Inspect
portfolio.value(prices);    // total dollar value
portfolio.weights(prices);  // current allocation weights

// Compute trades
const trades = portfolio.trades(target, prices, '2026-03-31');
// → sells first, then buys
```

## Non-Goals

- Database persistence of portfolios
- Brokerage integration (SnapTrade) — future work
- Trade execution or order management
- Tax-lot awareness
- Whole-share rounding (can be added later as an option)
