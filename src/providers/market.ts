import type { DailyBar } from '../handles/indicator.js';

export interface MarketProvider {
  fetchBars(symbol: string, from?: string): Promise<DailyBar[]>;
}
