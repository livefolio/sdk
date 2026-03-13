import { describe, it, expect, vi } from 'vitest';
import {
  mapStoredOrder,
  hasAutoDeploySlot,
  tryClaimAutoDeploySlot,
  upsertAutoDeploy,
  deleteAutoDeployByUserAndStrategy,
  selectAutoDeploysByUserId,
  hasAnyOrderHistory,
  insertPendingOrderBatch,
  selectPendingOrderBatchesByUserAndStrategy,
  claimExecutableOrderBatch,
  finalizeClaimedOrderRow,
  rejectPendingOrderBatch,
  ORDER_EXECUTION_CLAIM_STALE_MS,
} from './storage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    id: 1,
    batch_id: 'batch-1',
    user_id: 'user-1',
    strategy_id: 42,
    account_id: 'acc-1',
    allocation_name: 'Aggressive',
    action: 'BUY',
    symbol: 'AAPL',
    quantity: 10,
    estimated_price: 150.5,
    estimated_value: 1505,
    status: null,
    expires_at: '2026-01-01T00:00:00Z',
    confirmed_at: null,
    rejected_at: null,
    snaptrade_order_id: null,
    snaptrade_response: null,
    error: null,
    created_at: '2025-12-01T00:00:00Z',
    updated_at: '2025-12-01T00:00:00Z',
    ...overrides,
  };
}

function mockChain(opts: { data?: unknown; error?: unknown; count?: number } = {}) {
  const result = { data: opts.data ?? null, error: opts.error ?? null, count: opts.count };
  const chain: any = {
    ...result,
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    not: vi.fn(() => chain),
    gt: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    single: vi.fn(() => chain),
    maybeSingle: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    then: vi.fn((resolve: any) => resolve(result)),
  };
  return chain;
}

function mockClient(chain?: any): any {
  const c = chain ?? mockChain();
  return {
    from: vi.fn(() => c),
    rpc: vi.fn(() => ({ data: false, error: null })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mapStoredOrder', () => {
  it('maps snake_case row to camelCase StoredOrder', () => {
    const row = makeRow({ status: 'confirmed', confirmed_at: '2025-12-02T00:00:00Z' });
    const result = mapStoredOrder(row);
    expect(result.id).toBe(1);
    expect(result.batchId).toBe('batch-1');
    expect(result.userId).toBe('user-1');
    expect(result.strategyId).toBe(42);
    expect(result.action).toBe('BUY');
    expect(result.symbol).toBe('AAPL');
    expect(result.quantity).toBe(10);
    expect(result.status).toBe('confirmed');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.confirmedAt).toBeInstanceOf(Date);
    expect(result.rejectedAt).toBeNull();
  });
});

describe('hasAutoDeploySlot', () => {
  it('returns true when count > 0', async () => {
    const chain = mockChain({ count: 1 });
    const client = mockClient(chain);
    const result = await hasAutoDeploySlot(client, 'user-1');
    expect(result).toBe(true);
    expect(client.from).toHaveBeenCalledWith('autodeploy_slots');
  });

  it('returns false when count is 0', async () => {
    const chain = mockChain({ count: 0 });
    const client = mockClient(chain);
    const result = await hasAutoDeploySlot(client, 'user-1');
    expect(result).toBe(false);
  });

  it('throws on error', async () => {
    const chain = mockChain({ error: { message: 'db error' } });
    const client = mockClient(chain);
    await expect(hasAutoDeploySlot(client, 'user-1')).rejects.toThrow('Failed to check autodeploy slot');
  });
});

describe('tryClaimAutoDeploySlot', () => {
  it('returns rpc result', async () => {
    const client = mockClient();
    client.rpc = vi.fn(() => ({ data: true, error: null }));
    const result = await tryClaimAutoDeploySlot(client, 'user-1');
    expect(result).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith('claim_autodeploy_slot', { p_user_id: 'user-1' });
  });

  it('throws on rpc error', async () => {
    const client = mockClient();
    client.rpc = vi.fn(() => ({ data: null, error: { message: 'rpc fail' } }));
    await expect(tryClaimAutoDeploySlot(client, 'user-1')).rejects.toThrow('Failed to claim autodeploy slot');
  });
});

describe('upsertAutoDeploy', () => {
  it('upserts subscription row', async () => {
    const chain = mockChain();
    const client = mockClient(chain);
    await upsertAutoDeploy(client, 'user-1', 42, 'acc-1');
    expect(client.from).toHaveBeenCalledWith('subscriptions');
    expect(chain.upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', strategy_id: 42, account_id: 'acc-1' },
      { onConflict: 'user_id,strategy_id' },
    );
  });

  it('throws on error', async () => {
    const chain = mockChain({ error: { message: 'upsert fail' } });
    const client = mockClient(chain);
    await expect(upsertAutoDeploy(client, 'user-1', 42, 'acc-1')).rejects.toThrow('Failed to upsert auto_deploy');
  });
});

describe('deleteAutoDeployByUserAndStrategy', () => {
  it('sets account_id to null', async () => {
    const chain = mockChain();
    const client = mockClient(chain);
    await deleteAutoDeployByUserAndStrategy(client, 'user-1', 42);
    expect(client.from).toHaveBeenCalledWith('subscriptions');
    expect(chain.update).toHaveBeenCalledWith({ account_id: null });
  });

  it('throws on error', async () => {
    const chain = mockChain({ error: { message: 'delete fail' } });
    const client = mockClient(chain);
    await expect(deleteAutoDeployByUserAndStrategy(client, 'user-1', 42)).rejects.toThrow(
      'Failed to delete auto_deploy',
    );
  });
});

describe('selectAutoDeploysByUserId', () => {
  it('returns empty array when no rows', async () => {
    const chain = mockChain({ data: [] });
    const client: any = {
      from: vi.fn((table: string) => {
        if (table === 'autodeploy_slots') return mockChain({ count: 1 });
        return chain;
      }),
    };
    const result = await selectAutoDeploysByUserId(client, 'user-1');
    expect(result).toEqual([]);
  });

  it('maps rows to AutoDeploy[]', async () => {
    const rows = [
      {
        user_id: 'user-1',
        strategy_id: 42,
        account_id: 'acc-1',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
        strategy: { link_id: 'link-42' },
      },
    ];
    const client: any = {
      from: vi.fn((table: string) => {
        if (table === 'autodeploy_slots') return mockChain({ count: 1 });
        return mockChain({ data: rows });
      }),
    };
    const result = await selectAutoDeploysByUserId(client, 'user-1');
    expect(result).toHaveLength(1);
    expect(result[0].strategyLinkId).toBe('link-42');
    expect(result[0].waitlisted).toBe(false);
  });

  it('throws on query error', async () => {
    const chain = mockChain({ error: { message: 'fail' } });
    const client = mockClient(chain);
    await expect(selectAutoDeploysByUserId(client, 'user-1')).rejects.toThrow('Failed to fetch auto_deploys');
  });
});

describe('hasAnyOrderHistory', () => {
  it('returns true when count > 0', async () => {
    const chain = mockChain({ count: 3 });
    const client = mockClient(chain);
    const result = await hasAnyOrderHistory(client, 'user-1', 42, 'acc-1');
    expect(result).toBe(true);
    expect(client.from).toHaveBeenCalledWith('orders');
  });

  it('returns false when count is 0', async () => {
    const chain = mockChain({ count: 0 });
    const client = mockClient(chain);
    const result = await hasAnyOrderHistory(client, 'user-1', 42, 'acc-1');
    expect(result).toBe(false);
  });

  it('throws on error', async () => {
    const chain = mockChain({ error: { message: 'db err' } });
    const client = mockClient(chain);
    await expect(hasAnyOrderHistory(client, 'user-1', 42, 'acc-1')).rejects.toThrow('Failed to check order history');
  });
});

describe('insertPendingOrderBatch', () => {
  it('inserts order rows', async () => {
    const chain = mockChain();
    const client = mockClient(chain);
    await insertPendingOrderBatch(client, {
      batchId: 'b-1',
      userId: 'user-1',
      strategyId: 42,
      accountId: 'acc-1',
      allocationName: 'Growth',
      orders: [
        { action: 'BUY', symbol: 'AAPL', quantity: 5, estimatedPrice: 150, estimatedValue: 750 },
        { action: 'SELL', symbol: 'GOOG', quantity: 2, estimatedPrice: 100, estimatedValue: 200 },
      ],
      expiresAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(client.from).toHaveBeenCalledWith('orders');
    expect(chain.insert).toHaveBeenCalledTimes(1);
    const insertedRows = chain.insert.mock.calls[0][0];
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0].batch_id).toBe('b-1');
    expect(insertedRows[1].symbol).toBe('GOOG');
  });

  it('throws on insert error', async () => {
    const chain = mockChain({ error: { message: 'insert fail' } });
    const client = mockClient(chain);
    await expect(
      insertPendingOrderBatch(client, {
        batchId: 'b-1',
        userId: 'user-1',
        strategyId: 42,
        accountId: 'acc-1',
        allocationName: 'A',
        orders: [],
        expiresAt: new Date(),
      }),
    ).rejects.toThrow('Failed to insert pending orders');
  });
});

describe('selectPendingOrderBatchesByUserAndStrategy', () => {
  it('returns empty when strategy not found', async () => {
    const client: any = {
      from: vi.fn((table: string) => {
        if (table === 'strategies') return mockChain({ data: null, error: { code: 'PGRST116' } });
        return mockChain({ data: [] });
      }),
    };
    const result = await selectPendingOrderBatchesByUserAndStrategy(client, 'user-1', 'link-1', new Date());
    expect(result).toEqual([]);
  });
});

describe('claimExecutableOrderBatch', () => {
  it('returns claimed orders on first attempt', async () => {
    const rows = [makeRow({ id: 1 })];
    const chain = mockChain({ data: rows });
    const client = mockClient(chain);

    const now = new Date('2025-12-15T00:00:00Z');
    const claimedAt = new Date('2025-12-15T00:00:01Z');
    const result = await claimExecutableOrderBatch(client, 'batch-1', 'user-1', now, claimedAt);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('falls back to stale attempt when first returns empty', async () => {
    let callCount = 0;
    const staleClaim = [makeRow({ id: 2 })];
    const client: any = {
      from: vi.fn(() => {
        callCount++;
        if (callCount <= 1) return mockChain({ data: [] });
        return mockChain({ data: staleClaim });
      }),
    };

    const now = new Date('2025-12-15T00:00:00Z');
    const claimedAt = new Date('2025-12-15T00:00:01Z');
    const result = await claimExecutableOrderBatch(client, 'batch-1', 'user-1', now, claimedAt);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });
});

describe('finalizeClaimedOrderRow', () => {
  it('confirms order on success', async () => {
    const chain = mockChain();
    const client = mockClient(chain);
    const claimedAt = new Date('2025-12-15T00:00:00Z');
    await finalizeClaimedOrderRow(client, 1, claimedAt, {
      snaptradeOrderId: 'st-1',
      snaptradeResponse: { ok: true },
    });
    expect(client.from).toHaveBeenCalledWith('orders');
    expect(chain.update).toHaveBeenCalled();
    const updateArg = chain.update.mock.calls[0][0];
    expect(updateArg.status).toBe('confirmed');
    expect(updateArg.snaptrade_order_id).toBe('st-1');
  });

  it('releases order on error', async () => {
    const chain = mockChain();
    const client = mockClient(chain);
    const claimedAt = new Date('2025-12-15T00:00:00Z');
    await finalizeClaimedOrderRow(client, 1, claimedAt, { error: 'placement failed' });
    expect(chain.update).toHaveBeenCalled();
    const updateArg = chain.update.mock.calls[0][0];
    expect(updateArg.confirmed_at).toBeNull();
    expect(updateArg.error).toBe('placement failed');
  });

  it('throws on DB error during confirm', async () => {
    const chain = mockChain({ error: { message: 'db fail' } });
    const client = mockClient(chain);
    const claimedAt = new Date('2025-12-15T00:00:00Z');
    await expect(
      finalizeClaimedOrderRow(client, 1, claimedAt, { snaptradeOrderId: 'st-1' }),
    ).rejects.toThrow('Failed to confirm order 1');
  });

  it('throws on DB error during release', async () => {
    const chain = mockChain({ error: { message: 'db fail' } });
    const client = mockClient(chain);
    const claimedAt = new Date('2025-12-15T00:00:00Z');
    await expect(
      finalizeClaimedOrderRow(client, 1, claimedAt, { error: 'bad' }),
    ).rejects.toThrow('Failed to release failed order 1');
  });
});

describe('rejectPendingOrderBatch', () => {
  it('updates both unlocked and stale orders', async () => {
    const chain = mockChain();
    const client = mockClient(chain);
    const now = new Date('2025-12-15T00:00:00Z');
    await rejectPendingOrderBatch(client, 'batch-1', 'user-1', now);
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it('throws on first update error', async () => {
    const chain = mockChain({ error: { message: 'reject fail' } });
    const client = mockClient(chain);
    const now = new Date('2025-12-15T00:00:00Z');
    await expect(rejectPendingOrderBatch(client, 'batch-1', 'user-1', now)).rejects.toThrow(
      'Failed to reject order batch batch-1',
    );
  });
});

describe('ORDER_EXECUTION_CLAIM_STALE_MS', () => {
  it('is 5 minutes', () => {
    expect(ORDER_EXECUTION_CLAIM_STALE_MS).toBe(5 * 60 * 1000);
  });
});
