export * as auth from './auth';
export * as market from './market';
export * as strategy from './strategy';
export * as portfolio from './portfolio';
export * as billing from './billing';

export type { TypedSupabaseClient, LivefolioClientConfig } from './types';
export type { AuthModule } from './auth';
export type { MarketModule } from './market';
export type { StrategyModule } from './strategy';
export type { PortfolioModule } from './portfolio';
export type { BillingModule, UserTier } from './billing';

import type { TypedSupabaseClient, LivefolioClientConfig } from './types';
import type { AuthModule } from './auth';
import type { MarketModule } from './market';
import type { StrategyModule } from './strategy';
import type { PortfolioModule } from './portfolio';
import type { BillingModule } from './billing';
import { createAuth } from './auth';
import { createMarket } from './market';
import { createStrategy } from './strategy';
import { createPortfolio } from './portfolio';
import { createBilling } from './billing';

export interface LivefolioClient {
  readonly supabase: TypedSupabaseClient;
  readonly auth: AuthModule;
  readonly market: MarketModule;
  readonly strategy: StrategyModule;
  readonly portfolio: PortfolioModule;
  readonly billing: BillingModule;
}

export function createLivefolioClient(
  supabase: TypedSupabaseClient,
  config?: LivefolioClientConfig,
): LivefolioClient {
  return {
    supabase,
    auth: createAuth(supabase, config),
    market: createMarket(supabase),
    strategy: createStrategy(supabase),
    portfolio: createPortfolio(supabase),
    billing: createBilling(supabase),
  };
}
