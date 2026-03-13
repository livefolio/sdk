import type { TypedSupabaseClient } from '../types';
import type { SubscriptionModule } from './types';
import * as storage from './storage';

export function createSubscription(client: TypedSupabaseClient, userId?: string): SubscriptionModule {
  return {
    subscribe: (strategyLinkId, accountId?) => {
      if (!userId) throw new Error('Authenticated user required');
      return storage.subscribe(client, userId, strategyLinkId, accountId);
    },
    unsubscribe: (strategyLinkId) => {
      if (!userId) throw new Error('Authenticated user required');
      return storage.unsubscribe(client, userId, strategyLinkId);
    },
    list: () => {
      if (!userId) throw new Error('Authenticated user required');
      return storage.listByUser(client, userId);
    },
    get: (strategyLinkId) => {
      if (!userId) throw new Error('Authenticated user required');
      return storage.getByUserAndStrategy(client, userId, strategyLinkId);
    },
    count: () => {
      if (!userId) throw new Error('Authenticated user required');
      return storage.countByUser(client, userId);
    },
    listAll: () => storage.listAll(client),
    listApprovedAutoDeployUserIds: () => storage.listApprovedAutoDeployUserIds(client),
  };
}
