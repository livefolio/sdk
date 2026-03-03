import type { Ticker } from '../strategy/types';
import type { RebalancePlanInput, RebalancePlan } from './rebalance';

export interface PortfolioModule {
  buildRebalancePlan(input: RebalancePlanInput): RebalancePlan;
  computePortfolioDriftPercentPoints(input: {
    targetWeights: Map<string, number>;
    currentValues: Map<string, number>;
    cashValue: number;
    totalValue: number;
  }): number;
  mapTickerToBrokerable(ticker: Ticker): string | null;
}
