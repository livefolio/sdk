import type { TypedSupabaseClient } from '../types';
import type { PortfolioModule } from './types';
import { buildRebalancePlan, computePortfolioDriftPercentPoints } from './rebalance';
import { mapTickerToBrokerable } from './symbols';

export function createPortfolio(_client: TypedSupabaseClient): PortfolioModule {
  return {
    buildRebalancePlan,
    computePortfolioDriftPercentPoints,
    mapTickerToBrokerable,
  };
}
