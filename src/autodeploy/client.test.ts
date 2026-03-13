import { describe, it, expect, vi } from 'vitest';
import { createAutoDeploy } from './client';
import type { BrokerOperations } from './types';

function mockClient(): any {
  const chain: any = {
    data: null,
    error: null,
    count: 0,
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
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    delete: vi.fn(() => chain),
  };
  return {
    from: vi.fn(() => chain),
    rpc: vi.fn(() => ({ data: false, error: null })),
  };
}

function mockBroker(): BrokerOperations {
  return {
    getHoldings: vi.fn().mockResolvedValue({ positions: [], balances: [] }),
    getQuotes: vi.fn().mockResolvedValue([]),
    listInstruments: vi.fn().mockResolvedValue([]),
    placeOrder: vi.fn().mockResolvedValue({ brokerageOrderId: 'o1' }),
    getOrderDetail: vi.fn().mockResolvedValue({ status: 'EXECUTED' }),
  };
}

describe('createAutoDeploy', () => {
  it('returns a module with all expected methods', () => {
    const mod = createAutoDeploy(mockClient(), {
      broker: mockBroker(),
      userId: 'user-1',
    });

    expect(typeof mod.calculateRequiredTrades).toBe('function');
    expect(typeof mod.createPendingOrders).toBe('function');
    expect(typeof mod.listPendingBatches).toBe('function');
    expect(typeof mod.confirmBatch).toBe('function');
    expect(typeof mod.rejectBatch).toBe('function');
    expect(typeof mod.hasSlot).toBe('function');
    expect(typeof mod.tryClaimSlot).toBe('function');
    expect(typeof mod.enable).toBe('function');
    expect(typeof mod.disable).toBe('function');
    expect(typeof mod.list).toBe('function');
    expect(typeof mod.hasOrderHistory).toBe('function');
  });

  it('throws when broker is not configured', () => {
    const mod = createAutoDeploy(mockClient(), { userId: 'user-1' });
    expect(() => mod.calculateRequiredTrades('acc-1', {} as any)).toThrow(
      'AutoDeployModule requires a broker',
    );
  });

  it('throws when userId is not configured for user-scoped ops', () => {
    const mod = createAutoDeploy(mockClient(), { broker: mockBroker() });
    expect(() => mod.hasSlot()).toThrow('AutoDeployModule requires a userId');
  });

  it('throws when no config provided', () => {
    const mod = createAutoDeploy(mockClient());
    expect(() => mod.enable(1, 'acc-1')).toThrow('AutoDeployModule requires a userId');
    expect(() => mod.calculateRequiredTrades('acc-1', {} as any)).toThrow(
      'AutoDeployModule requires a broker',
    );
  });

  it('delegates hasSlot to storage', async () => {
    const chain: any = {
      data: null,
      error: null,
      count: 1,
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
    };
    const client: any = { from: vi.fn(() => chain) };
    const mod = createAutoDeploy(client, { userId: 'user-1', broker: mockBroker() });
    const result = await mod.hasSlot();
    expect(result).toBe(true);
    expect(client.from).toHaveBeenCalledWith('autodeploy_slots');
  });

  it('delegates tryClaimSlot to storage', async () => {
    const client = mockClient();
    client.rpc = vi.fn(() => ({ data: true, error: null }));
    const mod = createAutoDeploy(client, { userId: 'user-1', broker: mockBroker() });
    const result = await mod.tryClaimSlot();
    expect(result).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith('claim_autodeploy_slot', { p_user_id: 'user-1' });
  });

  it('delegates enable to upsertAutoDeploy', async () => {
    const chain: any = {
      data: null,
      error: null,
      upsert: vi.fn(() => chain),
    };
    const client: any = { from: vi.fn(() => chain) };
    const mod = createAutoDeploy(client, { userId: 'user-1', broker: mockBroker() });
    await mod.enable(42, 'acc-1');
    expect(client.from).toHaveBeenCalledWith('subscriptions');
    expect(chain.upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', strategy_id: 42, account_id: 'acc-1' },
      { onConflict: 'user_id,strategy_id' },
    );
  });

  it('delegates disable to deleteAutoDeployByUserAndStrategy', async () => {
    const chain: any = {
      data: null,
      error: null,
      update: vi.fn(() => chain),
      eq: vi.fn(() => chain),
    };
    const client: any = { from: vi.fn(() => chain) };
    const mod = createAutoDeploy(client, { userId: 'user-1', broker: mockBroker() });
    await mod.disable(42);
    expect(client.from).toHaveBeenCalledWith('subscriptions');
    expect(chain.update).toHaveBeenCalledWith({ account_id: null });
  });
});
