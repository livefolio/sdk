import type { TypedSupabaseClient } from '../types';
import type { AutoDeployModule, BrokerOperations } from './types';
import { calculateRequiredTrades } from './trades';
import { executeTradeOrders } from './execute';
import * as storage from './storage';
import { randomUUID } from 'node:crypto';

export interface AutoDeployConfig {
  broker?: BrokerOperations;
  userId?: string;
}

export function createAutoDeploy(
  client: TypedSupabaseClient,
  config?: AutoDeployConfig,
): AutoDeployModule {
  function requireUserId(): string {
    if (!config?.userId) {
      throw new Error('AutoDeployModule requires a userId — pass userId in AutoDeployConfig');
    }
    return config.userId;
  }

  function requireBroker(): BrokerOperations {
    if (!config?.broker) {
      throw new Error('AutoDeployModule requires a broker — pass broker in AutoDeployConfig');
    }
    return config.broker;
  }

  return {
    calculateRequiredTrades: (accountId, allocation) =>
      calculateRequiredTrades(requireBroker(), accountId, allocation),

    createPendingOrders: async (params) => {
      const userId = requireUserId();
      const batchId = randomUUID();
      await storage.insertPendingOrderBatch(client, {
        batchId,
        userId,
        strategyId: params.strategyId,
        accountId: params.accountId,
        allocationName: params.allocationName,
        orders: params.orders,
        expiresAt: params.expiresAt,
      });
      return {
        batchId,
        allocationName: params.allocationName,
        expiresAt: params.expiresAt,
        orders: params.orders.map((o, i) => ({
          id: i,
          batchId,
          userId,
          strategyId: params.strategyId,
          accountId: params.accountId,
          allocationName: params.allocationName,
          action: o.action,
          symbol: o.symbol,
          quantity: o.quantity,
          estimatedPrice: o.estimatedPrice,
          estimatedValue: o.estimatedValue,
          status: null,
          expiresAt: params.expiresAt,
          confirmedAt: null,
          rejectedAt: null,
          snaptradeOrderId: null,
          snaptradeResponse: null,
          error: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      };
    },

    listPendingBatches: (strategyLinkId) => {
      const userId = requireUserId();
      return storage.selectPendingOrderBatchesByUserAndStrategy(client, userId, strategyLinkId, new Date());
    },

    confirmBatch: async (batchId) => {
      const userId = requireUserId();
      const broker = requireBroker();
      const now = new Date();
      const claimedAt = new Date();
      const claimed = await storage.claimExecutableOrderBatch(client, batchId, userId, now, claimedAt);
      if (claimed.length === 0) {
        return { results: new Map() };
      }
      const accountId = claimed[0].accountId;
      const executionResults = await executeTradeOrders(broker, accountId, claimed);

      for (const order of claimed) {
        const result = executionResults.get(order.id);
        if (result) {
          await storage.finalizeClaimedOrderRow(client, order.id, claimedAt, result);
        }
      }

      return { results: executionResults };
    },

    rejectBatch: (batchId) => {
      const userId = requireUserId();
      return storage.rejectPendingOrderBatch(client, batchId, userId, new Date());
    },

    hasSlot: () => storage.hasAutoDeploySlot(client, requireUserId()),

    tryClaimSlot: () => storage.tryClaimAutoDeploySlot(client, requireUserId()),

    enable: (strategyId, accountId) =>
      storage.upsertAutoDeploy(client, requireUserId(), strategyId, accountId),

    disable: (strategyId) =>
      storage.deleteAutoDeployByUserAndStrategy(client, requireUserId(), strategyId),

    list: () => storage.selectAutoDeploysByUserId(client, requireUserId()),

    hasOrderHistory: (strategyId, accountId) =>
      storage.hasAnyOrderHistory(client, requireUserId(), strategyId, accountId),
  };
}
