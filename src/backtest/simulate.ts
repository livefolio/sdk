import type { DailyBar } from '../handles/indicator.js';
import type { StrategyBar } from '../handles/strategy.js';
import type { Trade } from './types.js';

const EPSILON = 1e-8;

export function runSimulation(
  bars: StrategyBar[],
  prices: Record<string, Record<string, number>>,
  rebalanceDates: Set<string>,
  initialCapital: number,
): { series: DailyBar[]; trades: Trade[] } {
  const positions: Record<string, number> = {};
  let cash = initialCapital;
  const series: DailyBar[] = [];
  const trades: Trade[] = [];

  for (const bar of bars) {
    const date = bar.date;

    if (rebalanceDates.has(date)) {
      // Compute current portfolio value before rebalancing
      let portfolioValue = cash;
      for (const [symbol, shares] of Object.entries(positions)) {
        const price = prices[symbol]?.[date];
        if (price != null) portfolioValue += shares * price;
      }

      // Determine target holdings
      const targetWeights: Record<string, number> = {};
      for (const [ticker, weight] of bar.allocation.holdings) {
        targetWeights[ticker.symbol] = weight;
      }

      // Compute target shares and execute trades
      const allSymbols = new Set([...Object.keys(positions), ...Object.keys(targetWeights)]);
      for (const symbol of allSymbols) {
        const price = prices[symbol]?.[date];
        if (price == null || price <= 0) continue;

        const currentShares = positions[symbol] ?? 0;
        const targetValue = portfolioValue * (targetWeights[symbol] ?? 0);
        const targetShares = targetValue / price;
        const delta = targetShares - currentShares;

        if (Math.abs(delta) <= EPSILON) continue;

        if (Math.abs(targetShares) <= EPSILON) {
          delete positions[symbol];
        } else {
          positions[symbol] = targetShares;
        }
        cash -= delta * price;

        trades.push({
          date,
          symbol,
          quantity: Math.abs(delta),
          price,
          action: delta > 0 ? 'buy' : 'sell',
        });
      }

      if (Math.abs(cash) <= EPSILON) cash = 0;
    }

    // Compute end-of-day portfolio value
    let value = cash;
    for (const [symbol, shares] of Object.entries(positions)) {
      const price = prices[symbol]?.[date];
      if (price != null) value += shares * price;
    }
    series.push({ date, value });
  }

  return { series, trades };
}
