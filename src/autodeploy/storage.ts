import type { TypedSupabaseClient } from '../types';
import type { StoredOrder, TradeOrder, AutoDeploy, PendingBatch } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ORDER_EXECUTION_CLAIM_STALE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function mapStoredOrder(row: {
  id: number;
  batch_id: string;
  user_id: string;
  strategy_id: number;
  account_id: string;
  allocation_name: string;
  action: string;
  symbol: string;
  quantity: number;
  estimated_price: number | null;
  estimated_value: number | null;
  status: string | null;
  expires_at: string;
  confirmed_at: string | null;
  rejected_at: string | null;
  snaptrade_order_id: string | null;
  snaptrade_response: unknown;
  error: string | null;
  created_at: string;
  updated_at: string;
}): StoredOrder {
  return {
    id: row.id,
    batchId: row.batch_id,
    userId: row.user_id,
    strategyId: row.strategy_id,
    accountId: row.account_id,
    allocationName: row.allocation_name,
    action: row.action as 'BUY' | 'SELL',
    symbol: row.symbol,
    quantity: row.quantity,
    estimatedPrice: row.estimated_price,
    estimatedValue: row.estimated_value,
    status: row.status as 'confirmed' | 'rejected' | 'expired' | null,
    expiresAt: new Date(row.expires_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : null,
    rejectedAt: row.rejected_at ? new Date(row.rejected_at) : null,
    snaptradeOrderId: row.snaptrade_order_id,
    snaptradeResponse: row.snaptrade_response,
    error: row.error,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Slot management
// ---------------------------------------------------------------------------

export async function hasAutoDeploySlot(client: TypedSupabaseClient, userId: string): Promise<boolean> {
  const { count, error } = await client
    .from('autodeploy_slots')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw new Error(`Failed to check autodeploy slot: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function tryClaimAutoDeploySlot(client: TypedSupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client.rpc('claim_autodeploy_slot', { p_user_id: userId });
  if (error) throw new Error(`Failed to claim autodeploy slot: ${error.message}`);
  return data as boolean;
}

// ---------------------------------------------------------------------------
// Auto-deploy CRUD
// ---------------------------------------------------------------------------

export async function upsertAutoDeploy(
  client: TypedSupabaseClient,
  userId: string,
  strategyId: number,
  accountId: string,
): Promise<void> {
  const { error } = await client
    .from('subscriptions')
    .upsert({ user_id: userId, strategy_id: strategyId, account_id: accountId }, { onConflict: 'user_id,strategy_id' });
  if (error) {
    throw new Error(`Failed to upsert auto_deploy: ${error.message}`);
  }
}

export async function deleteAutoDeployByUserAndStrategy(
  client: TypedSupabaseClient,
  userId: string,
  strategyId: number,
): Promise<void> {
  const { error } = await client
    .from('subscriptions')
    .update({ account_id: null })
    .eq('user_id', userId)
    .eq('strategy_id', strategyId);
  if (error) {
    throw new Error(`Failed to delete auto_deploy: ${error.message}`);
  }
}

export async function selectAutoDeploysByUserId(
  client: TypedSupabaseClient,
  userId: string,
): Promise<AutoDeploy[]> {
  const { data, error } = await client
    .from('subscriptions')
    .select('user_id, strategy_id, account_id, created_at, updated_at, strategy:strategies(link_id)')
    .eq('user_id', userId)
    .not('account_id', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch auto_deploys: ${error.message}`);
  }

  if (!data || data.length === 0) return [];

  const hasSlot = await hasAutoDeploySlot(client, userId);

  return data.map((row) => {
    const strategy = row.strategy as unknown as { link_id: string } | null;
    if (!strategy) throw new Error('Invalid auto_deploy data: missing strategy');
    return {
      userId: row.user_id,
      strategyId: row.strategy_id,
      strategyLinkId: strategy.link_id,
      accountId: row.account_id!,
      waitlisted: !hasSlot,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  });
}

// ---------------------------------------------------------------------------
// Order history
// ---------------------------------------------------------------------------

export async function hasAnyOrderHistory(
  client: TypedSupabaseClient,
  userId: string,
  strategyId: number,
  accountId: string,
): Promise<boolean> {
  const { count, error } = await client
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('strategy_id', strategyId)
    .eq('account_id', accountId);

  if (error) {
    throw new Error(`Failed to check order history: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Order CRUD
// ---------------------------------------------------------------------------

export async function insertPendingOrderBatch(
  client: TypedSupabaseClient,
  params: {
    batchId: string;
    userId: string;
    strategyId: number;
    accountId: string;
    allocationName: string;
    orders: TradeOrder[];
    expiresAt: Date;
  },
): Promise<void> {
  const rows = params.orders.map((order) => ({
    batch_id: params.batchId,
    user_id: params.userId,
    strategy_id: params.strategyId,
    account_id: params.accountId,
    allocation_name: params.allocationName,
    action: order.action,
    symbol: order.symbol,
    quantity: order.quantity,
    estimated_price: order.estimatedPrice,
    estimated_value: order.estimatedValue,
    expires_at: params.expiresAt.toISOString(),
  }));

  const { error } = await client.from('orders').insert(rows);
  if (error) {
    throw new Error(`Failed to insert pending orders: ${error.message}`);
  }
}

export async function selectPendingOrderBatchesByUserAndStrategy(
  client: TypedSupabaseClient,
  userId: string,
  strategyLinkId: string,
  now: Date,
): Promise<PendingBatch[]> {
  // Get strategy ID from link_id
  const { data: strategyData, error: strategyError } = await client
    .from('strategies')
    .select('id')
    .eq('link_id', strategyLinkId)
    .single();

  if (strategyError) return [];

  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - ORDER_EXECUTION_CLAIM_STALE_MS).toISOString();

  const [{ data: unlockedRows, error: unlockedError }, { data: staleRows, error: staleError }] = await Promise.all([
    client
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .eq('strategy_id', strategyData.id)
      .is('status', null)
      .is('confirmed_at', null)
      .gt('expires_at', nowIso)
      .order('id', { ascending: true }),
    client
      .from('orders')
      .select('*')
      .eq('user_id', userId)
      .eq('strategy_id', strategyData.id)
      .is('status', null)
      .lt('confirmed_at', staleBeforeIso)
      .gt('expires_at', nowIso)
      .order('id', { ascending: true }),
  ]);

  if (unlockedError) {
    throw new Error(`Failed to fetch pending orders: ${unlockedError.message}`);
  }
  if (staleError) {
    throw new Error(`Failed to fetch pending orders: ${staleError.message}`);
  }

  const rows = [...(unlockedRows ?? []), ...(staleRows ?? [])].sort((a, b) => a.id - b.id);

  // Group by batch_id
  const batches = new Map<string, StoredOrder[]>();
  for (const row of rows) {
    const order = mapStoredOrder(row);
    const existing = batches.get(order.batchId) ?? [];
    existing.push(order);
    batches.set(order.batchId, existing);
  }

  return Array.from(batches.entries()).map(([batchId, orders]) => ({
    batchId,
    allocationName: orders[0].allocationName,
    expiresAt: orders[0].expiresAt,
    orders,
  }));
}

async function claimExecutableOrderBatchAttempt(
  client: TypedSupabaseClient,
  input: {
    batchId: string;
    userId: string;
    now: Date;
    claimedAt: Date;
    staleBefore?: Date;
  },
): Promise<StoredOrder[]> {
  let query = client
    .from('orders')
    .update({
      confirmed_at: input.claimedAt.toISOString(),
    })
    .eq('batch_id', input.batchId)
    .eq('user_id', input.userId)
    .is('status', null)
    .gt('expires_at', input.now.toISOString());

  if (input.staleBefore) {
    query = query.lt('confirmed_at', input.staleBefore.toISOString());
  } else {
    query = query.is('confirmed_at', null);
  }

  const { data, error } = await query.select('*');

  if (error) {
    throw new Error(`Failed to claim executable orders: ${error.message}`);
  }

  return (data ?? []).map(mapStoredOrder).sort((a, b) => a.id - b.id);
}

export async function claimExecutableOrderBatch(
  client: TypedSupabaseClient,
  batchId: string,
  userId: string,
  now: Date,
  claimedAt: Date,
): Promise<StoredOrder[]> {
  const claimed = await claimExecutableOrderBatchAttempt(client, { batchId, userId, now, claimedAt });
  if (claimed.length > 0) return claimed;

  const staleBefore = new Date(now.getTime() - ORDER_EXECUTION_CLAIM_STALE_MS);
  return claimExecutableOrderBatchAttempt(client, { batchId, userId, now, claimedAt, staleBefore });
}

export async function finalizeClaimedOrderRow(
  client: TypedSupabaseClient,
  id: number,
  claimedAt: Date,
  meta: { snaptradeOrderId?: string; snaptradeResponse?: unknown; error?: string },
): Promise<void> {
  const claimIso = claimedAt.toISOString();

  if (meta.error) {
    const { error } = await client
      .from('orders')
      .update({
        confirmed_at: null,
        snaptrade_order_id: null,
        snaptrade_response: null,
        error: meta.error,
      })
      .eq('id', id)
      .is('status', null)
      .eq('confirmed_at', claimIso);

    if (error) {
      throw new Error(`Failed to release failed order ${id}: ${error.message}`);
    }
    return;
  }

  const { error } = await client
    .from('orders')
    .update({
      status: 'confirmed' as const,
      confirmed_at: new Date().toISOString(),
      snaptrade_order_id: meta.snaptradeOrderId ?? null,
      snaptrade_response: (meta.snaptradeResponse as any) ?? null,
      error: null,
    })
    .eq('id', id)
    .is('status', null)
    .eq('confirmed_at', claimIso);

  if (error) {
    throw new Error(`Failed to confirm order ${id}: ${error.message}`);
  }
}

export async function rejectPendingOrderBatch(
  client: TypedSupabaseClient,
  batchId: string,
  userId: string,
  now: Date,
): Promise<void> {
  const rejectedAt = new Date().toISOString();
  const staleBeforeIso = new Date(now.getTime() - ORDER_EXECUTION_CLAIM_STALE_MS).toISOString();

  const { error: unlockedError } = await client
    .from('orders')
    .update({
      status: 'rejected' as const,
      rejected_at: rejectedAt,
    })
    .eq('batch_id', batchId)
    .eq('user_id', userId)
    .is('status', null)
    .is('confirmed_at', null)
    .gt('expires_at', now.toISOString());

  if (unlockedError) {
    throw new Error(`Failed to reject order batch ${batchId}: ${unlockedError.message}`);
  }

  const { error: staleError } = await client
    .from('orders')
    .update({
      status: 'rejected' as const,
      rejected_at: rejectedAt,
    })
    .eq('batch_id', batchId)
    .eq('user_id', userId)
    .is('status', null)
    .lt('confirmed_at', staleBeforeIso)
    .gt('expires_at', now.toISOString());

  if (staleError) {
    throw new Error(`Failed to reject order batch ${batchId}: ${staleError.message}`);
  }
}
