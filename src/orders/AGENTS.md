<!-- Parent: ../AGENTS.md -->

# src/orders

## Purpose
The `Order` discriminated union and `Fill` type. Pure type declarations — no runtime code. Strategies emit `Order[]`; the `Executor` consumes them and returns `Fill[]`.

## Key Files

| File | Description |
|------|-------------|
| `types.ts` | `Order = OpenOrder \| CloseOrder \| AdjustOrder \| RebalanceOrder`. `Fill` records the executed quantity, price, and timestamp |
| `index.ts` | Barrel |

## For AI Agents

### Working In This Directory
- Type-only — no runtime imports allowed
- The order union is closed: every `Executor` impl must handle every variant exhaustively (TypeScript exhaustiveness check enforces this)
- New order kind? Add to the union here, then update every `Executor` impl. Audit `applyFills`/`applyOrders` in `src/portfolio/` for handling
