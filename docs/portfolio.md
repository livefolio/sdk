# Portfolio Module

Brokerage account aggregation and rebalancing.

```ts
const lf = createLivefolioClient(supabase);
```

## Methods

### `buildRebalancePlan(input): RebalancePlan`

Build a rebalance plan from target weights and current holdings.

### `computePortfolioDriftPercentPoints(input): number`

Compute portfolio drift as a percentage point value from target weights.

### `mapTickerToTradable(ticker): string | null`

Map a strategy ticker (with leverage) to a tradable ETF symbol. Returns `null` if no mapping exists.
