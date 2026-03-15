export * as auth from './auth';
export * as market from './market';
export * as strategy from './strategy';
export * as strategyBuilder from './strategy-builder';
export * as portfolio from './portfolio';

export type { TypedSupabaseClient } from './types';
export type { AuthModule } from './auth';
export type { MarketModule } from './market';
export type { StrategyModule } from './strategy';
export type { PortfolioModule } from './portfolio';

import type { TypedSupabaseClient } from './types';
import type { AuthModule } from './auth';
import type { MarketModule } from './market';
import type { StrategyModule } from './strategy';
import type { PortfolioModule } from './portfolio';
import { createAuth } from './auth';
import { createMarket } from './market';
import { createStrategy } from './strategy';
import { createPortfolio } from './portfolio';

export interface LivefolioClient {
  readonly supabase: TypedSupabaseClient;
  readonly auth: AuthModule;
  readonly market: MarketModule;
  readonly strategy: StrategyModule;
  readonly portfolio: PortfolioModule;
}

export function createLivefolioClient(supabase: TypedSupabaseClient): LivefolioClient {
  return {
    supabase,
    auth: createAuth(supabase),
    market: createMarket(supabase),
    strategy: createStrategy(supabase),
    portfolio: createPortfolio(supabase),
  };
}
