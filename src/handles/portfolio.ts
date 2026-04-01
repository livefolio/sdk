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
}
