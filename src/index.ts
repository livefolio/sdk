export * as auth from './auth';
export * as market from './market';
export * as strategy from './strategy';
export * as portfolio from './portfolio';
export * as broker from './broker';
export * as subscription from './subscription';
export * as autodeploy from './autodeploy';

export type { TypedSupabaseClient } from './types';
export type { AuthModule } from './auth';
export type { MarketModule } from './market';
export type { StrategyModule } from './strategy';
export type { PortfolioModule } from './portfolio';
export type { BrokerModule } from './broker';
export type { SubscriptionModule } from './subscription';
export type { AutoDeployModule } from './autodeploy';

import type { TypedSupabaseClient } from './types';
import type { AuthModule } from './auth';
import type { MarketModule } from './market';
import type { StrategyModule } from './strategy';
import type { PortfolioModule } from './portfolio';
import type { BrokerModule } from './broker';
import type { SubscriptionModule } from './subscription';
import type { AutoDeployModule } from './autodeploy';
import type { SnapTradeOperations } from './broker/types';
import type { BrokerOperations } from './autodeploy/types';
import { createAuth } from './auth';
import { createMarket } from './market';
import { createStrategy } from './strategy';
import { createPortfolio } from './portfolio';
import { createBroker } from './broker';
import { createSubscription } from './subscription';
import { createAutoDeploy } from './autodeploy';

export interface SnapTradeConfig {
  client: SnapTradeOperations;
  encryptionKey: string;
}

export interface LivefolioClientConfig {
  supabaseUrl: string;
  supabaseKey: string;
  snaptrade?: SnapTradeConfig;
  userId?: string;
  brokerOperations?: BrokerOperations;
}

export interface LivefolioClient {
  readonly supabase: TypedSupabaseClient;
  readonly auth: AuthModule;
  readonly market: MarketModule;
  readonly strategy: StrategyModule;
  readonly portfolio: PortfolioModule;
  readonly broker: BrokerModule;
  readonly subscription: SubscriptionModule;
  readonly autodeploy: AutoDeployModule;
}

export function createLivefolioClient(supabase: TypedSupabaseClient, options?: {
  snaptrade?: SnapTradeConfig;
  userId?: string;
  brokerOperations?: BrokerOperations;
}): LivefolioClient {
  return {
    supabase,
    auth: createAuth(supabase),
    market: createMarket(supabase),
    strategy: createStrategy(supabase),
    portfolio: createPortfolio(supabase),
    broker: createBroker(supabase, options?.snaptrade ? {
      snaptrade: options.snaptrade.client,
      userId: options.userId,
      encryptionKey: options.snaptrade.encryptionKey,
    } : undefined),
    subscription: createSubscription(supabase, options?.userId),
    autodeploy: createAutoDeploy(supabase, {
      broker: options?.brokerOperations,
      userId: options?.userId,
    }),
  };
}
