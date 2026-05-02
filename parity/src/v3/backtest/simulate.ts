import type { DailyBar } from '../handles/indicator';
import type { StrategyBar } from '../handles/strategy';
import type { TickerHandle } from '../handles/ticker';
import type { Trade } from './types';
import { PortfolioHandle } from '../handles/portfolio';
import { isRateTickerSymbol } from '../providers/mappings';

const EPSILON = 1e-8;

function tkey(symbol: string, leverage: number): string {
  return `${symbol}:${leverage}`;
}

function symbolFromKey(key: string): string {
  const idx = key.lastIndexOf(':');
  return idx === -1 ? key : key.slice(0, idx);
}

function isRateKey(key: string): boolean {
  return isRateTickerSymbol(symbolFromKey(key));
}

function navPriceForKey(
  key: string,
  date: string,
  prices: Record<string, Record<string, number>>,
  lastPrice: Record<string, number>,
): number | undefined {
  if (isRateKey(key)) return 1;
  const live = prices[key]?.[date];
  if (live != null) {
    lastPrice[key] = live;
    return live;
  }
  return lastPrice[key];
}

function daysBetween(prevIsoDate: string, currIsoDate: string): number {
  // Both inputs are 'YYYY-MM-DD'. UTC midnight → diff in ms → days.
  const ms =
    Date.UTC(Number(currIsoDate.slice(0, 4)), Number(currIsoDate.slice(5, 7)) - 1, Number(currIsoDate.slice(8, 10))) -
    Date.UTC(Number(prevIsoDate.slice(0, 4)), Number(prevIsoDate.slice(5, 7)) - 1, Number(prevIsoDate.slice(8, 10)));
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function runSimulation(
  bars: StrategyBar[],
  prices: Record<string, Record<string, number>>,
  rebalanceDates: Set<string>,
  portfolio: PortfolioHandle,
): { series: DailyBar[]; trades: Trade[]; finalPortfolio: PortfolioHandle } {
  const positions: Record<string, number> = {};
  const lastPrice: Record<string, number> = {};
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

  // Carry forward the last known close when today's price is missing so
  // a held position isn't silently valued at $0 (e.g. mutual fund NAV that
  // posts after the trading-day cutoff).
  function valuationPrice(key: string, date: string): number | undefined {
    return navPriceForKey(key, date, prices, lastPrice);
  }

  let prevDate: string | null = null;

  for (const bar of bars) {
    const date = bar.date;

    // Accrue interest on rate-ticker positions between the previous bar and today.
    if (prevDate != null) {
      const days = daysBetween(prevDate, date);
      if (days > 0) {
        for (const [key, shares] of Object.entries(positions)) {
          if (!isRateKey(key)) continue;
          const ratePct = prices[key]?.[prevDate];
          if (ratePct == null) continue;
          const leverage = Number(key.slice(key.lastIndexOf(':') + 1)) || 1;
          const factor = 1 + leverage * (ratePct / 100) * (days / 360);
          positions[key] = shares * factor;
        }
      }
    }

    if (rebalanceDates.has(date)) {
      // Compute current portfolio value before rebalancing
      let portfolioValue = cash;
      for (const [key, shares] of Object.entries(positions)) {
        const price = valuationPrice(key, date);
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
        let price: number;
        if (isRateKey(key)) {
          price = 1;
        } else {
          const live = prices[key]?.[date];
          if (live == null || live <= 0) continue;
          price = live;
        }

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
      const price = valuationPrice(key, date);
      if (price != null) value += shares * price;
    }
    series.push({ date, value });
    prevDate = date;
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
