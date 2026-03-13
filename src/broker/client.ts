import type { TypedSupabaseClient } from '../types';
import type { BrokerModule, SnapTradeOperations } from './types';
import {
  getStatus,
  ensureUserRegistered,
  listConnections,
  getConnectionUrl,
  removeConnection,
  getHoldings,
  listActivities,
  listRecentOrders,
  getOrderDetail,
  getQuotes,
  searchSymbols,
  previewTradeImpact,
  placeOrder,
  listInstruments,
} from './broker';

export interface BrokerConfig {
  snaptrade?: SnapTradeOperations;
  userId?: string;
  encryptionKey?: string;
}

export function createBroker(
  client: TypedSupabaseClient,
  config?: BrokerConfig,
): BrokerModule {
  function requireSnaptrade(): SnapTradeOperations {
    if (!config?.snaptrade) {
      throw new Error(
        'BrokerModule requires a SnapTrade client — pass snaptrade in BrokerConfig',
      );
    }
    return config.snaptrade;
  }

  function requireUserId(): string {
    if (!config?.userId) {
      throw new Error(
        'BrokerModule requires a userId — pass userId in BrokerConfig',
      );
    }
    return config.userId;
  }

  function requireEncryptionKey(): string {
    if (!config?.encryptionKey) {
      throw new Error(
        'BrokerModule requires an encryptionKey — pass encryptionKey in BrokerConfig',
      );
    }
    return config.encryptionKey;
  }

  return {
    getStatus: () => getStatus(requireSnaptrade()),

    ensureUserRegistered: () =>
      ensureUserRegistered(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
      ),

    listConnections: () =>
      listConnections(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
      ),

    getConnectionUrl: (params) =>
      getConnectionUrl(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
        params,
      ),

    removeConnection: (authorizationId) =>
      removeConnection(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
        authorizationId,
      ),

    getHoldings: (accountId) =>
      getHoldings(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
        accountId,
      ),

    listActivities: (accountId, options) =>
      listActivities(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
        accountId,
        options,
      ),

    listRecentOrders: (accountId, options) =>
      listRecentOrders(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
        accountId,
        options,
      ),

    getOrderDetail: (accountId, brokerageOrderId) =>
      getOrderDetail(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
        accountId,
        brokerageOrderId,
      ),

    getQuotes: (accountId, symbols) =>
      getQuotes(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
        accountId,
        symbols,
      ),

    searchSymbols: (substring, accountId) =>
      searchSymbols(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
        substring,
        accountId,
      ),

    previewTradeImpact: (accountId, params) =>
      previewTradeImpact(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
        accountId,
        params,
      ),

    placeOrder: (accountId, order) =>
      placeOrder(
        client,
        requireSnaptrade(),
        requireUserId(),
        requireEncryptionKey(),
        accountId,
        order,
      ),

    listInstruments: (brokerageSlug) =>
      listInstruments(requireSnaptrade(), brokerageSlug),
  };
}
