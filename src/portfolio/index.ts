import type { TypedSupabaseClient } from '../types';

export interface PortfolioModule {
  // Methods will be added as portfolio features are implemented
}

export function createPortfolio(_client: TypedSupabaseClient): PortfolioModule {
  return {};
}
