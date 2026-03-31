import type { DailyBar } from '../handles/indicator.js';

export interface SimulateOptions {
  from: string;
  to: string;
  initialCapital?: number;
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
  readonly initialCapital: number;

  constructor(series: DailyBar[], trades: Trade[], initialCapital: number) {
    this.series = series;
    this.trades = trades;
    this.initialCapital = initialCapital;
  }
}
