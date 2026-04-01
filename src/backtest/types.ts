import type { DailyBar } from '../handles/indicator.js';
import { PortfolioHandle } from '../handles/portfolio.js';

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

export class SimulationHandle {
  readonly series: DailyBar[];
  readonly trades: Trade[];
  readonly startingPortfolio: PortfolioHandle;

  constructor(series: DailyBar[], trades: Trade[], startingPortfolio: PortfolioHandle) {
    this.series = series;
    this.trades = trades;
    this.startingPortfolio = startingPortfolio;
  }
}
