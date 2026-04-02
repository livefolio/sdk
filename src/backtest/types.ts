import type { DailyBar } from '../handles/indicator.js';
import type { AllocationHandle } from '../handles/allocation.js';
import { PortfolioHandle } from '../handles/portfolio.js';
import type { TickerHandle } from '../handles/ticker.js';

export interface SimulateOptions {
  from: string;
  to: string;
  portfolio: PortfolioHandle;
}

export interface Trade {
  date: string;
  symbol: string;
  quantity: number;
  price: number;
  action: 'buy' | 'sell';
}

export interface PortfolioSnapshot {
  value: number;
  holdings: [TickerHandle, number][];
  weights: [TickerHandle, number][];
  pendingTrades: Trade[];
}

export interface FinalState {
  portfolio: PortfolioHandle;
  allocation: AllocationHandle;
  closePrices: Record<string, number>;
  leveragedPrices: Record<string, number>;
}

export class SimulationHandle {
  readonly series: DailyBar[];
  readonly trades: Trade[];
  readonly startingPortfolio: PortfolioHandle;

  private _portfolio: PortfolioHandle | null;
  private _currentAllocation: AllocationHandle | null;
  private _lastClosePrices: Record<string, number>;
  private _lastLeveragedPrices: Map<string, number>;
  private _currentLeveragedPrices: Map<string, number>;
  private _lastDate: string;

  constructor(series: DailyBar[], trades: Trade[], startingPortfolio: PortfolioHandle, finalState?: FinalState) {
    this.series = series;
    this.trades = trades;
    this.startingPortfolio = startingPortfolio;

    if (finalState) {
      this._portfolio = finalState.portfolio;
      this._currentAllocation = finalState.allocation;
      this._lastClosePrices = finalState.closePrices;
      this._lastLeveragedPrices = new Map(Object.entries(finalState.leveragedPrices));
      this._currentLeveragedPrices = new Map(Object.entries(finalState.leveragedPrices));
      this._lastDate = series.at(-1)?.date ?? '';
    } else {
      this._portfolio = null;
      this._currentAllocation = null;
      this._lastClosePrices = {};
      this._lastLeveragedPrices = new Map();
      this._currentLeveragedPrices = new Map();
      this._lastDate = '';
    }
  }

  push(...prices: [TickerHandle, number][]): PortfolioSnapshot {
    if (!this._portfolio || !this._currentAllocation) {
      return { value: 0, holdings: [], weights: [], pendingTrades: [] };
    }

    // Update leveraged prices from raw market prices
    for (const [ticker, realPrice] of prices) {
      if (ticker.symbol === 'CASHX') continue;
      const lastClose = this._lastClosePrices[ticker.symbol];
      if (lastClose == null) continue;

      const realReturn = (realPrice - lastClose) / lastClose;

      // Apply leverage to all portfolio tickers sharing this symbol
      for (const [held] of this._portfolio.holdings) {
        if (held.symbol !== ticker.symbol) continue;
        if (held.symbol === 'CASHX') continue;
        const key = `${held.symbol}:${held.leverage}`;
        const baseLeveragedPrice = this._lastLeveragedPrices.get(key);
        if (baseLeveragedPrice == null) continue;
        const leveragedReturn = held.leverage * realReturn;
        this._currentLeveragedPrices.set(key, baseLeveragedPrice * (1 + leveragedReturn));
      }
    }

    // Build price array for PortfolioHandle methods
    const priceArray: [TickerHandle, number][] = [];
    for (const [held] of this._portfolio.holdings) {
      if (held.symbol === 'CASHX') continue;
      const key = `${held.symbol}:${held.leverage}`;
      const price = this._currentLeveragedPrices.get(key);
      if (price != null) priceArray.push([held, price]);
    }

    return {
      value: this._portfolio.value(priceArray),
      holdings: this._portfolio.holdings,
      weights: this._portfolio.weights(priceArray),
      pendingTrades: this._portfolio.trades(this._currentAllocation, priceArray, this._lastDate),
    };
  }
}
