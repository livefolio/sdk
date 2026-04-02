import type { DailyBar } from '../handles/indicator';
import type { StrategyBar } from '../handles/strategy';
import type { TickerHandle } from '../handles/ticker';
import type { Trade } from './types';
import { PortfolioHandle } from '../handles/portfolio';

const EPSILON = 1e-8;

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
      positions[ticker.symbol] = quantity;
    }
  }
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

  // Build finalPortfolio from ending positions + cash
  const finalHoldings: [TickerHandle, number][] = [];

  // Map symbols back to TickerHandles from the last bar's allocation
  const tickerBySymbol = new Map<string, TickerHandle>();
  for (const bar of bars) {
    for (const [ticker] of bar.allocation.holdings) {
      if (!tickerBySymbol.has(ticker.symbol)) {
        tickerBySymbol.set(ticker.symbol, ticker);
      }
    }
  }
  // Also include tickers from the starting portfolio (may hold tickers not in any allocation)
  for (const [ticker] of portfolio.holdings) {
    if (!tickerBySymbol.has(ticker.symbol)) {
      tickerBySymbol.set(ticker.symbol, ticker);
    }
  }

  for (const [symbol, shares] of Object.entries(positions)) {
    const ticker = tickerBySymbol.get(symbol);
    if (ticker && Math.abs(shares) > EPSILON) {
      finalHoldings.push([ticker, shares]);
    }
  }

  // Add CASHX
  const cashTicker = tickerBySymbol.get('CASHX') ?? portfolio.holdings.find(([t]) => t.symbol === 'CASHX')?.[0];
  if (cashTicker && Math.abs(cash) > EPSILON) {
    finalHoldings.push([cashTicker, cash]);
  }

  const finalPortfolio = new PortfolioHandle(finalHoldings);

  return { series, trades, finalPortfolio };
}
