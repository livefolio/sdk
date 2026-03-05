import type { Ticker } from '../strategy/types';
import type { RebalancePlanInput, RebalancePlan } from './rebalance';

export interface PortfolioModule {
  buildRebalancePlan(input: RebalancePlanInput): RebalancePlan;
  computePortfolioDriftPercentPoints(input: {
    targetWeights: Record<string, number>;
    currentValues: Record<string, number>;
    cashValue: number;
    totalValue: number;
  }): number;
  mapTickerToTradable(ticker: Ticker): string | null;
}
