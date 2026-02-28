import type { TypedSupabaseClient } from '../types';

export interface MarketModule {
  // Methods will be added as market features are implemented
}

export function createMarket(_client: TypedSupabaseClient): MarketModule {
  return {};
}
