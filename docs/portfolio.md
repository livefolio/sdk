# Portfolio Module

Brokerage account aggregation and rebalancing.

```ts
const lf = createLivefolioClient(supabase);
```

## Methods

### `buildRebalancePlan(input): RebalancePlan`

Build a rebalance plan from target weights and current holdings.

```ts
const plan = lf.portfolio.buildRebalancePlan({
  targetWeights: { SPY: 0.6, TLT: 0.4 },
  currentValues: { SPY: 6500, TLT: 3500 },
  prices: { SPY: 590, TLT: 95 },
  cashValue: 200,
  totalValue: 10200,
});
// → {
//     triggered: true,
//     portfolioDriftPercentPoints: 3.2,
//     reason: 'ok',
//     orders: [
//       { action: 'BUY', symbol: 'TLT', quantity: 6, estimatedPrice: 95, estimatedValue: 570 },
//       { action: 'SELL', symbol: 'SPY', quantity: 1, estimatedPrice: 590, estimatedValue: 590 },
//     ]
//   }
```

### `computePortfolioDriftPercentPoints(input): number`

Compute portfolio drift as a percentage point value from target weights.

```ts
const drift = lf.portfolio.computePortfolioDriftPercentPoints({
  targetWeights: { SPY: 0.6, TLT: 0.4 },
  currentValues: { SPY: 7000, TLT: 3000 },
  cashValue: 0,
  totalValue: 10000,
});
// → 10 (percentage points of drift from target)
```

### `mapTickerToTradable(ticker): string | null`

Map a strategy ticker (with leverage) to a tradable ETF symbol. Returns `null` if no mapping exists.

```ts
lf.portfolio.mapTickerToTradable({ symbol: 'SPY', leverage: 1 });  // 'SPY'
lf.portfolio.mapTickerToTradable({ symbol: 'SPY', leverage: 3 });  // 'UPRO'
lf.portfolio.mapTickerToTradable({ symbol: 'SPY', leverage: -1 }); // 'SH'
```
