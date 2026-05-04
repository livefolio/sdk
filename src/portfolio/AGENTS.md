<!-- Parent: ../AGENTS.md -->

# src/portfolio

## Purpose
`Position` / `Portfolio` types and the pure functions that update a portfolio in response to orders and fills. Used by `runBacktest` between session loops; available standalone for paper-trading and live-broker adapters.

## Key Files

| File | Description |
|------|-------------|
| `types.ts` | `Position { asset, quantity, basis }`, `Portfolio { cash, positions, t }` |
| `apply.ts` | `applyFills(portfolio, fills, orders) → Portfolio` (advance the portfolio by a fill batch); `applyOrders(portfolio, orders, prices) → Portfolio` (apply orders at given prices, primarily for live preview) |
| `index.ts` | Barrel |

## For AI Agents

### Working In This Directory
- All operations are pure: `applyFills(p, fills, orders)` returns a new `Portfolio`; the input is never mutated
- `Position.basis` tracks weighted-average cost. Closes reduce basis proportionally; opens add to basis at fill price
- Cash arithmetic is straightforward: opens decrement, closes increment, by `quantity × price`
- No fee/slippage/tax modeling here — that belongs in the `Executor`'s fill production

### Testing Requirements
- `apply.test.ts` exercises the four order kinds (open/close/adjust/rebalance) and edge cases (zero quantity, negative qty for shorts, basis recomputation)
