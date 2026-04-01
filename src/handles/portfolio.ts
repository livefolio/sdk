import { TickerHandle } from './ticker.js';

export class PortfolioHandle {
  readonly holdings: [TickerHandle, number][];

  constructor(holdings: [TickerHandle, number][]) {
    // Check for duplicates
    const seen = new Set<string>();
    for (const [ticker, quantity] of holdings) {
      const key = `${ticker.symbol}:${ticker.leverage}`;
      if (seen.has(key)) {
        throw new Error(`Duplicate ticker: ${ticker.symbol}`);
      }
      seen.add(key);

      if (quantity < 0) {
        throw new Error(`Quantity for ${ticker.symbol} is negative: ${quantity}`);
      }
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
}
