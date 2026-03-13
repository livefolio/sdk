import type { TypedSupabaseClient } from '../types';
import type { Subscription, SubscriptionWithEmail } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function lookupStrategyId(client: TypedSupabaseClient, linkId: string): Promise<number> {
  const { data, error } = await client
    .from('strategies')
    .select('id')
    .eq('link_id', linkId)
    .single();

  if (error || !data) {
    throw new Error(`Strategy not found: ${linkId}`);
  }

  return data.id;
}

// ---------------------------------------------------------------------------
// User-scoped operations
// ---------------------------------------------------------------------------

export async function subscribe(
  client: TypedSupabaseClient,
  userId: string,
  strategyLinkId: string,
  accountId?: string,
): Promise<void> {
  const strategyId = await lookupStrategyId(client, strategyLinkId);

  const { error } = await client
    .from('subscriptions')
    .upsert(
      { user_id: userId, strategy_id: strategyId, account_id: accountId ?? null },
      { onConflict: 'user_id,strategy_id' },
    );

  if (error) {
    throw new Error(`Failed to upsert subscription: ${error.message}`);
  }
}

export async function unsubscribe(
  client: TypedSupabaseClient,
  userId: string,
  strategyLinkId: string,
): Promise<void> {
  const strategyId = await lookupStrategyId(client, strategyLinkId);

  const { error } = await client
    .from('subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('strategy_id', strategyId);

  if (error) {
    throw new Error(`Failed to delete subscription: ${error.message}`);
  }
}

export async function listByUser(
  client: TypedSupabaseClient,
  userId: string,
): Promise<Subscription[]> {
  const { data, error } = await client
    .from('subscriptions')
    .select('user_id, strategy_id, account_id, created_at, updated_at, strategy:strategies(link_id)')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to fetch subscriptions: ${error.message}`);
  }

  if (!data || data.length === 0) return [];

  return data
    .filter((row) => row.user_id && row.strategy_id && row.strategy && row.created_at && row.updated_at)
    .map((row) => ({
      userId: row.user_id,
      strategyId: row.strategy_id,
      strategyLinkId: (row.strategy as unknown as { link_id: string }).link_id,
      accountId: row.account_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
}

export async function getByUserAndStrategy(
  client: TypedSupabaseClient,
  userId: string,
  strategyLinkId: string,
): Promise<Subscription | null> {
  const { data: strategyData, error: strategyError } = await client
    .from('strategies')
    .select('id')
    .eq('link_id', strategyLinkId)
    .single();

  if (strategyError) {
    if (strategyError.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch strategy: ${strategyError.message}`);
  }

  const { data, error } = await client
    .from('subscriptions')
    .select('user_id, strategy_id, account_id, created_at, updated_at')
    .eq('user_id', userId)
    .eq('strategy_id', strategyData.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch subscription: ${error.message}`);
  }

  return {
    userId: data.user_id,
    strategyId: data.strategy_id,
    strategyLinkId,
    accountId: data.account_id,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}

export async function countByUser(
  client: TypedSupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await client
    .from('subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to count subscriptions: ${error.message}`);
  }

  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Admin (service_role) operations
// ---------------------------------------------------------------------------

export async function listAll(
  client: TypedSupabaseClient,
): Promise<SubscriptionWithEmail[]> {
  const { data, error } = await client
    .from('subscriptions_with_email')
    .select('user_id, strategy_id, email, account_id, created_at, updated_at, strategy:strategies(link_id)');

  if (error) {
    throw new Error(`Failed to fetch subscriptions: ${error.message}`);
  }

  if (!data || data.length === 0) return [];

  return data
    .filter((row) => row.user_id && row.strategy_id && row.email && row.strategy && row.created_at && row.updated_at)
    .map((row) => ({
      userId: row.user_id!,
      strategyId: row.strategy_id!,
      strategyLinkId: (row.strategy as unknown as { link_id: string }).link_id,
      email: row.email!,
      accountId: row.account_id ?? null,
      createdAt: new Date(row.created_at!),
      updatedAt: new Date(row.updated_at!),
    }));
}

export async function listApprovedAutoDeployUserIds(
  client: TypedSupabaseClient,
): Promise<Set<string>> {
  const { data, error } = await client
    .from('autodeploy_slots')
    .select('user_id');

  if (error) {
    throw new Error(`Failed to fetch autodeploy slots: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => row.user_id));
}
