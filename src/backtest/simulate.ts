import type { DailyBar } from '../handles/indicator';
import type { StrategyBar } from '../handles/strategy';
import type { TickerHandle } from '../handles/ticker';
import type { Trade } from './types';
import { PortfolioHandle } from '../handles/portfolio';

const EPSILON = 1e-8;

function tkey(symbol: string, leverage: number): string {
  return `${symbol}:${leverage}`;
}

export function runSimulation(
  bars: StrategyBar[],
  prices: Record<string, Record<string, number>>,
  rebalanceDates: Set<string>,
  portfolio: PortfolioHandle,
): { series: DailyBar[]; trades: Trade[]; finalPortfolio: PortfolioHandle } {
  const positions: Record<string, number> = {};
  let cash = 0;
  for (const [ticker, quantity] of portfolio.holdings) {
    if (ticker.symbol === 'CASHX') {
      cash = quantity;
    } else {
      positions[tkey(ticker.symbol, ticker.leverage)] = quantity;
    }
  }
  const series: DailyBar[] = [];
  const trades: Trade[] = [];

  for (const bar of bars) {
    const date = bar.date;

    if (rebalanceDates.has(date)) {
      // Compute current portfolio value before rebalancing
      let portfolioValue = cash;
      for (const [key, shares] of Object.entries(positions)) {
        const price = prices[key]?.[date];
        if (price != null) portfolioValue += shares * price;
      }

      // Determine target holdings
      const targetWeights: Record<string, number> = {};
      for (const [ticker, weight] of bar.allocation.holdings) {
        targetWeights[tkey(ticker.symbol, ticker.leverage)] = weight;
      }

      // Compute target shares and execute trades
      const allKeys = new Set([...Object.keys(positions), ...Object.keys(targetWeights)]);
      for (const key of allKeys) {
        const price = prices[key]?.[date];
        if (price == null || price <= 0) continue;

        const currentShares = positions[key] ?? 0;
        const targetValue = portfolioValue * (targetWeights[key] ?? 0);
        const targetShares = targetValue / price;
        const delta = targetShares - currentShares;

        if (Math.abs(delta) <= EPSILON) continue;

        if (Math.abs(targetShares) <= EPSILON) {
          delete positions[key];
        } else {
          positions[key] = targetShares;
        }
        cash -= delta * price;

        trades.push({
          date,
          symbol: key.split(':')[0]!,
          quantity: Math.abs(delta),
          price,
          action: delta > 0 ? 'buy' : 'sell',
        });
      }

      if (Math.abs(cash) <= EPSILON) cash = 0;
    }

    // Compute end-of-day portfolio value
    let value = cash;
    for (const [key, shares] of Object.entries(positions)) {
      const price = prices[key]?.[date];
      if (price != null) value += shares * price;
    }
    series.push({ date, value });
  }

  // Build finalPortfolio from ending positions + cash
  const finalHoldings: [TickerHandle, number][] = [];

  // Map ticker keys back to TickerHandles from allocations and starting portfolio
  const tickerByKey = new Map<string, TickerHandle>();
  for (const bar of bars) {
    for (const [ticker] of bar.allocation.holdings) {
      const key = tkey(ticker.symbol, ticker.leverage);
      if (!tickerByKey.has(key)) {
        tickerByKey.set(key, ticker);
      }
    }
  }
  for (const [ticker] of portfolio.holdings) {
    const key = tkey(ticker.symbol, ticker.leverage);
    if (!tickerByKey.has(key)) {
      tickerByKey.set(key, ticker);
    }
  }

  for (const [key, shares] of Object.entries(positions)) {
    const ticker = tickerByKey.get(key);
    if (ticker && Math.abs(shares) > EPSILON) {
      finalHoldings.push([ticker, shares]);
    }
  }

  // Add CASHX
  const cashKey = tkey('CASHX', 1);
  const cashTicker = tickerByKey.get(cashKey) ?? portfolio.holdings.find(([t]) => t.symbol === 'CASHX')?.[0];
  if (cashTicker && Math.abs(cash) > EPSILON) {
    finalHoldings.push([cashTicker, cash]);
  }

  const finalPortfolio = new PortfolioHandle(finalHoldings);

  return { series, trades, finalPortfolio };
}
