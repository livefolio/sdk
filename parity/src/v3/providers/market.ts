import type { DailyBar } from '../handles/indicator';

export interface MarketProvider {
  fetchBars(symbol: string, from?: string): Promise<DailyBar[]>;
}
