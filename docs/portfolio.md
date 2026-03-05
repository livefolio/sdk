# Portfolio Module

Rebalance planning, drift detection, and ticker-to-tradable symbol mapping.

## Setup

```ts
const portfolio = livefolio.portfolio;
```

## Methods

### `buildRebalancePlan(input)`

Generates a rebalance plan with trade orders to align a portfolio to target weights.

| Parameter | Type                 | Description                    |
|-----------|----------------------|--------------------------------|
| `input`   | `RebalancePlanInput` | Portfolio state and parameters |

**Returns** `RebalancePlan`

```ts
const plan = portfolio.buildRebalancePlan({
  targetWeights: { SPY: 60, TLT: 40 },
  currentValues: { SPY: 5000, TLT: 2000 },
  prices: { SPY: 590, TLT: 92 },
  cashValue: 3000,
  totalValue: 10000,
});

if (plan.triggered) {
  console.log(plan.orders);
  // [
  //   { action: 'SELL', symbol: 'SPY', quantity: 1.69, estimatedPrice: 590, estimatedValue: 997.1 },
  //   { action: 'BUY',  symbol: 'TLT', quantity: 21.59, estimatedPrice: 92, estimatedValue: 1986.28 },
  // ]
}
```

**Behavior:**
- Computes portfolio drift first; returns early with `reason: 'below_threshold'` if drift is below the threshold
- Processes **sells before buys** — sell proceeds (after slippage and fees) fund buy orders
- Buy prices are inflated by `buySlippageBps` when sizing quantities; sell proceeds are discounted by `sellSlippageBps`
- Maintains a cash reserve: the greater of `minCashReserveValue` or `cashReservePercent` of current cash
- Candidates below `minTradeValue` are filtered out to avoid dust trades
- Orders within each side are sorted by notional value (largest first); final output places all SELLs before BUYs
- Symbols matching `cashSymbol` are excluded from order generation (no price required)

---

### `computePortfolioDriftPercentPoints(input)`

Computes the portfolio drift as a single number in percentage points.

| Parameter             | Type                      | Description                         |
|-----------------------|---------------------------|-------------------------------------|
| `input.targetWeights` | `Record<string, number>`  | Target allocation (% per symbol)    |
| `input.currentValues` | `Record<string, number>`  | Current market value per symbol     |
| `input.cashValue`     | `number`                  | Current cash balance                |
| `input.totalValue`    | `number`                  | Total portfolio value               |

**Returns** `number` — drift in percentage points.

```ts
const drift = portfolio.computePortfolioDriftPercentPoints({
  targetWeights: { SPY: 60, TLT: 40 },
  currentValues: { SPY: 5000, TLT: 2000 },
  cashValue: 3000,
  totalValue: 10000,
});
// drift = 15 (portfolio is 15pp away from target)
```

**Formula:** Sum of absolute differences between target and current weight for each symbol (including implicit cash when target weights sum to less than 100), divided by 2.

> Throws if `totalValue` is not positive or any weight/value is negative.

---

### `mapTickerToTradable(ticker)`

Maps a strategy ticker (symbol + leverage) to the actual tradable symbol.

| Parameter | Type     | Description                         |
|-----------|----------|-------------------------------------|
| `ticker`  | `Ticker` | `{ symbol: string, leverage: number }` |

**Returns** `string | null` — tradable symbol, or `null` if the ticker maps to cash.

```ts
portfolio.mapTickerToTradable({ symbol: 'SPY', leverage: 1 });
// 'SPY'

portfolio.mapTickerToTradable({ symbol: 'SPY', leverage: 3 });
// 'UPRO'

portfolio.mapTickerToTradable({ symbol: 'VOO', leverage: 2 });
// 'SSO' (VOO aliased to SPY, then looked up at 2x)

portfolio.mapTickerToTradable({ symbol: 'DTB3', leverage: 1 });
// null (FRED rate → hold as cash)
```

**Three-stage pipeline:**
1. **FRED mapping** — if the symbol is in `FRED_TRADABLE_MAP`, return the mapped value immediately (`null` means cash)
2. **Leveraged/inverse ETF lookup** — when `leverage !== 1`, normalize via `BASE_TICKER_ALIASES` (e.g. VOO→SPY), build a `"SYMBOL:LEVERAGE"` key, look up in `ETF_LEVERAGE_MAP`
3. **Passthrough** — for unleveraged tickers not in the FRED map, return the symbol as-is

> **Throws** `Error` if a leveraged ticker has no ETF mapping in `ETF_LEVERAGE_MAP`.

---

## Types

### `RebalancePlanInput`

```ts
interface RebalancePlanInput {
  targetWeights: Record<string, number>;                // target allocation (% per symbol)
  currentValues: Record<string, number>;                // current market value per symbol
  prices: Record<string, number>;                       // latest price per symbol
  quantityPrecisionBySymbol?: Record<string, number>;   // precision per symbol (default: 100)
  cashValue: number;                                    // current cash balance
  totalValue: number;                                   // total portfolio value
  portfolioDriftThresholdPercentPoints?: number;        // min drift to trigger (default: 25)
  minTradeValue?: number;                               // ignore deltas below this (default: 1)
  cashReservePercent?: number;                          // % of cash to reserve (default: 1)
  minCashReserveValue?: number;                         // absolute min cash reserve (default: 10)
  buySlippageBps?: number;                              // inflate buy price by bps (default: 30)
  sellSlippageBps?: number;                             // discount sell proceeds by bps (default: 20)
  perOrderFee?: number;                                 // flat fee per order (default: 0)
  cashSymbol?: string;                                  // symbol treated as cash (no orders)
}
```

### `RebalancePlan`

```ts
interface RebalancePlan {
  triggered: boolean;                   // whether rebalancing was triggered
  portfolioDriftPercentPoints: number;  // computed drift value
  reason: 'below_threshold' | 'ok' | 'no_orders';
  orders: TradeOrder[];                 // trade orders (sells first, then buys)
}
```

| Reason             | Meaning                                           |
|--------------------|---------------------------------------------------|
| `below_threshold`  | Drift is below the threshold; no action needed    |
| `ok`               | Rebalance triggered and orders were generated     |
| `no_orders`        | Drift exceeded threshold but all orders filtered out (e.g. dust) |

### `TradeOrder`

```ts
interface TradeOrder {
  action: 'BUY' | 'SELL';
  symbol: string;
  quantity: number;
  estimatedPrice: number;
  estimatedValue: number;   // quantity × estimatedPrice
}
```

### `Ticker`

Shared with the Strategy module.

```ts
interface Ticker {
  symbol: string;
  leverage: number;   // 1 = unleveraged, 2/3 = bull, -1/-2/-3 = inverse
}
```

---

## Constants

All constants are exported from the package for consumers to reference or override via `RebalancePlanInput`.

### Rebalance Constants

| Constant                                     | Default | Description                                              |
|----------------------------------------------|---------|----------------------------------------------------------|
| `PORTFOLIO_DRIFT_THRESHOLD_PERCENT_POINTS`   | `25`    | Min portfolio drift (pp) before rebalancing triggers     |
| `REBALANCE_MIN_TRADE_VALUE`                  | `1`     | Ignore deltas below this notional value (dust filter)    |
| `REBALANCE_QUANTITY_PRECISION`               | `100`   | Default precision for fractionable symbols (2 decimals)  |
| `REBALANCE_WHOLE_SHARE_QUANTITY_PRECISION`   | `1`     | Precision for whole-share-only symbols                   |
| `REBALANCE_EPSILON`                          | `1e-9`  | Numeric tolerance for floating-point comparisons         |
| `REBALANCE_CASH_RESERVE_PERCENT`             | `1`     | Percentage of cash kept as safety reserve                |
| `REBALANCE_MIN_CASH_RESERVE_VALUE`           | `10`    | Absolute minimum dollar reserve kept as cash             |
| `REBALANCE_BUY_SLIPPAGE_BPS`                | `30`    | Inflate buy pricing by this many basis points            |
| `REBALANCE_SELL_SLIPPAGE_BPS`               | `20`    | Discount sell proceeds by this many basis points         |
| `REBALANCE_PER_ORDER_FEE`                   | `0`     | Flat per-order fee used in funding math                  |
| `REBALANCE_CASH_SYMBOL`                     | `'CASH'`| Canonical symbol used in `targetWeights` for cash        |
| `REBALANCE_CASH_SOURCE_SYMBOL`              | `'DTB3'`| Strategy ticker that means "hold as cash"                |

### Ticker Mapping Constants

| Constant              | Type                             | Description                                                           |
|-----------------------|----------------------------------|-----------------------------------------------------------------------|
| `FRED_TRADABLE_MAP`   | `Record<string, string \| null>` | Maps FRED rate symbols to tradable equivalents (`null` = cash)        |
| `BASE_TICKER_ALIASES` | `Record<string, string>`         | Normalizes equivalent tickers to a canonical symbol (VOO→SPY, IVV→SPY)|
| `ETF_LEVERAGE_MAP`    | `Record<string, string>`         | Maps `"SYMBOL:LEVERAGE"` keys to leveraged/inverse ETF tickers        |

---

## Key Behavior

### Execution Order

Sell orders are always placed before buy orders. This ensures that sale proceeds are available to fund purchases, maximizing the portfolio's ability to reach target weights in a single pass.

### Slippage Model

Buy orders use an inflated price (`price × (1 + buySlippageBps / 10000)`) when computing affordable quantities, ensuring the plan doesn't over-allocate. Sell proceeds are discounted (`estimatedValue × (1 - sellSlippageBps / 10000)`) to conservatively estimate available funds.

### Cash Reserve Logic

A cash reserve is maintained as the **greater** of `minCashReserveValue` (absolute floor) and `cashReservePercent / 100 × cashValue` (percentage of current cash). Only funds above this reserve are available for buy orders.

### Quantity Precision

Quantities are rounded down via `Math.floor(notional / price × precision) / precision`:
- **Fractionable symbols** default to precision `100` (2 decimal places, e.g. `1.23` shares)
- **Whole-share symbols** use precision `1` (integer shares only)
- Override per symbol via `quantityPrecisionBySymbol`

### FRED Priority in Ticker Mapping

FRED rate symbols (e.g. `DTB3`, `DFF`) are checked **first** in `mapTickerToTradable`. `DTB3` maps to `null` (hold as cash) and `DFF` maps to `USFR`. This runs before any leverage or alias logic.

### Alias Normalization

Before leveraged ETF lookup, tickers are normalized through `BASE_TICKER_ALIASES`. This means `VOO` at 2x and `SPY` at 2x both resolve to `SSO`. Currently supported aliases: VOO→SPY, IVV→SPY.
