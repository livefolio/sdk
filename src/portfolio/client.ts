import type { TypedSupabaseClient, LivefolioClientConfig, SnapTradeConfig } from '../types';
import type { PortfolioModule } from './types';
import { buildRebalancePlan, computePortfolioDriftPercentPoints } from './rebalance';
import { mapTickerToBrokerable } from './symbols';
import * as broker from './broker';

function requireSnapTrade(config?: LivefolioClientConfig): SnapTradeConfig {
  if (!config?.snaptrade) {
    throw new Error('SnapTrade config is required for broker operations');
  }
  return config.snaptrade;
}

export function createPortfolio(client: TypedSupabaseClient, config?: LivefolioClientConfig): PortfolioModule {
  return {
    // Pure planning
    buildRebalancePlan,
    computePortfolioDriftPercentPoints,
    mapTickerToBrokerable,

    // Broker — read
    async getConnections(userId) {
      return broker.getConnections(client, requireSnapTrade(config), userId);
    },
    async getHoldings(userId, accountId) {
      return broker.getHoldings(client, requireSnapTrade(config), userId, accountId);
    },
    async getActivities(userId, accountId, options) {
      return broker.getActivities(client, requireSnapTrade(config), userId, accountId, options);
    },
    async getRecentOrders(userId, accountId) {
      return broker.getRecentOrders(client, requireSnapTrade(config), userId, accountId);
    },
    async searchSymbols(substring) {
      return broker.searchSymbols(requireSnapTrade(config), substring);
    },
    async getQuotes(userId, accountId, symbols) {
      return broker.getQuotes(client, requireSnapTrade(config), userId, accountId, symbols);
    },

    // Broker — write
    async previewTradeImpact(userId, accountId, options) {
      return broker.previewTradeImpact(client, requireSnapTrade(config), userId, accountId, options);
    },
    async placeOrder(userId, accountId, order) {
      return broker.placeOrder(client, requireSnapTrade(config), userId, accountId, order);
    },

    // Broker — connection management
    async getConnectionUrl(userId, options) {
      return broker.getConnectionUrl(client, requireSnapTrade(config), userId, options);
    },
    async removeConnection(userId, authorizationId) {
      return broker.removeConnection(client, requireSnapTrade(config), userId, authorizationId);
    },
    async ensureUserRegistered(userId) {
      return broker.ensureUserRegistered(client, requireSnapTrade(config), userId);
    },
  };
}
