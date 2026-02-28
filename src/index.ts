export * as auth from './auth';
export * as market from './market';
export * as evaluator from './evaluator';
export * as portfolio from './portfolio';

export type { TypedSupabaseClient } from './types';
export type { AuthModule } from './auth';
export type { MarketModule } from './market';
export type { EvaluatorModule } from './evaluator';
export type { PortfolioModule } from './portfolio';

import type { TypedSupabaseClient } from './types';
import type { AuthModule } from './auth';
import type { MarketModule } from './market';
import type { EvaluatorModule } from './evaluator';
import type { PortfolioModule } from './portfolio';
import { createAuth } from './auth';
import { createMarket } from './market';
import { createEvaluator } from './evaluator';
import { createPortfolio } from './portfolio';

export interface LivefolioClient {
  readonly supabase: TypedSupabaseClient;
  readonly auth: AuthModule;
  readonly market: MarketModule;
  readonly evaluator: EvaluatorModule;
  readonly portfolio: PortfolioModule;
}

export function createLivefolioClient(supabase: TypedSupabaseClient): LivefolioClient {
  return {
    supabase,
    auth: createAuth(supabase),
    market: createMarket(supabase),
    evaluator: createEvaluator(supabase),
    portfolio: createPortfolio(supabase),
  };
}
