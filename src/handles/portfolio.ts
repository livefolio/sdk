import { TickerHandle } from './ticker';
import type { Trade } from '../backtest/types';
import { AllocationHandle } from './allocation';

export class PortfolioHandle {
  readonly holdings: [TickerHandle, number][];

  constructor(holdings: [TickerHandle, number][]) {
    // Check for duplicates
    const seen = new Set<string>();
    for (const [ticker] of holdings) {
      const key = `${ticker.symbol}:${ticker.leverage}`;
      if (seen.has(key)) {
        throw new Error(`Duplicate ticker: ${ticker.symbol}`);
      }
      seen.add(key);
    }

    this.holdings = holdings;
  }

  private _priceMap(prices: [TickerHandle, number][]): Map<string, number> {
    const map = new Map<string, number>();
    for (const [ticker, price] of prices) {
      map.set(`${ticker.symbol}:${ticker.leverage}`, price);
    }
    return map;
  }

  private _priceFor(ticker: TickerHandle, priceMap: Map<string, number>): number {
    if (ticker.symbol === 'CASHX') return 1;
    const key = `${ticker.symbol}:${ticker.leverage}`;
    const price = priceMap.get(key);
    if (price == null) {
      throw new Error(`Missing price for ${ticker.symbol}`);
    }
    return price;
  }

  value(prices: [TickerHandle, number][]): number {
    const priceMap = this._priceMap(prices);
    let total = 0;
    for (const [ticker, quantity] of this.holdings) {
      total += quantity * this._priceFor(ticker, priceMap);
    }
    return total;
  }

  weights(prices: [TickerHandle, number][]): [TickerHandle, number][] {
    const total = this.value(prices);
    if (total === 0) return [];

    const priceMap = this._priceMap(prices);
    const result: [TickerHandle, number][] = [];
    for (const [ticker, quantity] of this.holdings) {
      const dollarValue = quantity * this._priceFor(ticker, priceMap);
      if (dollarValue === 0) continue;
      result.push([ticker, dollarValue / total]);
    }
    return result;
  }

  trades(target: AllocationHandle, prices: [TickerHandle, number][], date: string): Trade[] {
    const priceMap = this._priceMap(prices);
    const totalValue = this.value(prices);

    // Build current dollar amounts by symbol
    const currentDollars = new Map<string, number>();
    for (const [ticker, quantity] of this.holdings) {
      if (ticker.symbol === 'CASHX') continue;
      const price = this._priceFor(ticker, priceMap);
      currentDollars.set(ticker.symbol, quantity * price);
    }

    // Build target dollar amounts by symbol
    const targetDollars = new Map<string, number>();
    for (const [ticker, weight] of target.holdings) {
      if (ticker.symbol === 'CASHX') continue;
      targetDollars.set(ticker.symbol, totalValue * weight);
    }

    // Build a symbol → TickerHandle lookup for price resolution
    const tickerBySymbol = new Map<string, TickerHandle>();
    for (const [ticker] of this.holdings) {
      if (ticker.symbol !== 'CASHX') tickerBySymbol.set(ticker.symbol, ticker);
    }
    for (const [ticker] of target.holdings) {
      if (ticker.symbol === 'CASHX') continue;
      const existing = tickerBySymbol.get(ticker.symbol);
      if (existing && existing.leverage !== ticker.leverage) {
        throw new Error(`Conflicting leverage for ${ticker.symbol}`);
      }
      tickerBySymbol.set(ticker.symbol, ticker);
    }

    // Collect all non-CASHX symbols from both sides
    const allSymbols = new Set([...currentDollars.keys(), ...targetDollars.keys()]);

    const sells: Trade[] = [];
    const buys: Trade[] = [];

    for (const symbol of allSymbols) {
      const current = currentDollars.get(symbol) ?? 0;
      const target$ = targetDollars.get(symbol) ?? 0;
      const delta = target$ - current;

      const ticker = tickerBySymbol.get(symbol)!;
      const price = this._priceFor(ticker, priceMap);

      const quantity = Math.abs(delta) / price;
      if (quantity < 1e-10) continue;

      const trade: Trade = { date, symbol, quantity, price, action: delta > 0 ? 'buy' : 'sell' };

      if (trade.action === 'sell') {
        sells.push(trade);
      } else {
        buys.push(trade);
      }
    }

    return [...sells, ...buys];
  }
}
