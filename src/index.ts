export * as auth from './auth';
export * as market from './market';
export * as strategy from './strategy';
export * as portfolio from './portfolio';
export * as admin from './admin';

export type { TypedSupabaseClient } from './types';
export type { AuthModule } from './auth';
export type { MarketModule } from './market';
export type { StrategyModule } from './strategy';
export type { PortfolioModule } from './portfolio';
export type { AdminModule } from './admin';

import type { TypedSupabaseClient } from './types';
import type { AuthModule } from './auth';
import type { MarketModule } from './market';
import type { StrategyModule } from './strategy';
import type { PortfolioModule } from './portfolio';
import type { AdminModule } from './admin';
import { createAuth } from './auth';
import { createMarket } from './market';
import { createStrategy } from './strategy';
import { createPortfolio } from './portfolio';
import { createAdmin } from './admin';

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

export interface LivefolioAdmin {
  readonly supabase: TypedSupabaseClient;
  readonly admin: AdminModule;
  readonly market: MarketModule;
  readonly strategy: StrategyModule;
}

export function createLivefolioAdmin(supabase: TypedSupabaseClient): LivefolioAdmin {
  return {
    supabase,
    admin: createAdmin(supabase),
    market: createMarket(supabase),
    strategy: createStrategy(supabase),
  };
}
