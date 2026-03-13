import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  subscribe,
  unsubscribe,
  listByUser,
  getByUserAndStrategy,
  countByUser,
  listAll,
  listApprovedAutoDeployUserIds,
} from './storage';

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

function createMockClient() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  chain.single = vi.fn();
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.upsert = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);

  const from = vi.fn().mockReturnValue(chain);
  const client = { from } as any;

  return { client, from, chain };
}

// ---------------------------------------------------------------------------
// subscribe
// ---------------------------------------------------------------------------

describe('subscribe', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
  });

  it('looks up strategy and upserts subscription', async () => {
    // First call: strategies lookup
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({ data: { id: 42 }, error: null });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    // Second call: subscriptions upsert
    const subscriptionsChain: Record<string, ReturnType<typeof vi.fn>> = {};
    subscriptionsChain.upsert = vi.fn().mockResolvedValue({ error: null });

    mock.from
      .mockReturnValueOnce(strategiesChain)
      .mockReturnValueOnce(subscriptionsChain);

    await subscribe(mock.client, 'user-1', 'link-abc', 'acct-1');

    expect(mock.from).toHaveBeenNthCalledWith(1, 'strategies');
    expect(strategiesChain.select).toHaveBeenCalledWith('id');
    expect(strategiesChain.eq).toHaveBeenCalledWith('link_id', 'link-abc');
    expect(strategiesChain.single).toHaveBeenCalled();

    expect(mock.from).toHaveBeenNthCalledWith(2, 'subscriptions');
    expect(subscriptionsChain.upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', strategy_id: 42, account_id: 'acct-1' },
      { onConflict: 'user_id,strategy_id' },
    );
  });

  it('defaults accountId to null when not provided', async () => {
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({ data: { id: 42 }, error: null });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    const subscriptionsChain: Record<string, ReturnType<typeof vi.fn>> = {};
    subscriptionsChain.upsert = vi.fn().mockResolvedValue({ error: null });

    mock.from
      .mockReturnValueOnce(strategiesChain)
      .mockReturnValueOnce(subscriptionsChain);

    await subscribe(mock.client, 'user-1', 'link-abc');

    expect(subscriptionsChain.upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', strategy_id: 42, account_id: null },
      { onConflict: 'user_id,strategy_id' },
    );
  });

  it('throws when strategy not found', async () => {
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'not found', code: 'PGRST116' },
    });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    mock.from.mockReturnValueOnce(strategiesChain);

    await expect(subscribe(mock.client, 'user-1', 'link-missing')).rejects.toThrow(
      'Strategy not found: link-missing',
    );
  });

  it('throws when upsert fails', async () => {
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({ data: { id: 42 }, error: null });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    const subscriptionsChain: Record<string, ReturnType<typeof vi.fn>> = {};
    subscriptionsChain.upsert = vi.fn().mockResolvedValue({
      error: { message: 'unique violation' },
    });

    mock.from
      .mockReturnValueOnce(strategiesChain)
      .mockReturnValueOnce(subscriptionsChain);

    await expect(subscribe(mock.client, 'user-1', 'link-abc')).rejects.toThrow(
      'Failed to upsert subscription: unique violation',
    );
  });
});

// ---------------------------------------------------------------------------
// unsubscribe
// ---------------------------------------------------------------------------

describe('unsubscribe', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
  });

  it('looks up strategy and deletes subscription', async () => {
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({ data: { id: 42 }, error: null });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    const subscriptionsChain: Record<string, ReturnType<typeof vi.fn>> = {};
    subscriptionsChain.eq = vi.fn().mockReturnValue(subscriptionsChain);
    subscriptionsChain.delete = vi.fn().mockReturnValue(subscriptionsChain);
    // Final .eq resolves the chain
    subscriptionsChain.eq
      .mockReturnValueOnce(subscriptionsChain) // .eq('user_id', ...)
      .mockResolvedValueOnce({ error: null }); // .eq('strategy_id', ...) → resolves

    mock.from
      .mockReturnValueOnce(strategiesChain)
      .mockReturnValueOnce(subscriptionsChain);

    await unsubscribe(mock.client, 'user-1', 'link-abc');

    expect(mock.from).toHaveBeenNthCalledWith(1, 'strategies');
    expect(mock.from).toHaveBeenNthCalledWith(2, 'subscriptions');
    expect(subscriptionsChain.delete).toHaveBeenCalled();
    expect(subscriptionsChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(subscriptionsChain.eq).toHaveBeenCalledWith('strategy_id', 42);
  });

  it('throws when strategy not found', async () => {
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'not found', code: 'PGRST116' },
    });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    mock.from.mockReturnValueOnce(strategiesChain);

    await expect(unsubscribe(mock.client, 'user-1', 'link-missing')).rejects.toThrow(
      'Strategy not found: link-missing',
    );
  });

  it('throws when delete fails', async () => {
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({ data: { id: 42 }, error: null });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    const subscriptionsChain: Record<string, ReturnType<typeof vi.fn>> = {};
    subscriptionsChain.eq = vi.fn().mockReturnValue(subscriptionsChain);
    subscriptionsChain.delete = vi.fn().mockReturnValue(subscriptionsChain);
    subscriptionsChain.eq
      .mockReturnValueOnce(subscriptionsChain)
      .mockResolvedValueOnce({ error: { message: 'fk constraint' } });

    mock.from
      .mockReturnValueOnce(strategiesChain)
      .mockReturnValueOnce(subscriptionsChain);

    await expect(unsubscribe(mock.client, 'user-1', 'link-abc')).rejects.toThrow(
      'Failed to delete subscription: fk constraint',
    );
  });
});

// ---------------------------------------------------------------------------
// listByUser
// ---------------------------------------------------------------------------

describe('listByUser', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
  });

  it('returns empty array when no subscriptions', async () => {
    mock.chain.eq.mockResolvedValueOnce({ data: [], error: null });

    const result = await listByUser(mock.client, 'user-1');

    expect(result).toEqual([]);
    expect(mock.from).toHaveBeenCalledWith('subscriptions');
    expect(mock.chain.select).toHaveBeenCalledWith(
      'user_id, strategy_id, account_id, created_at, updated_at, strategy:strategies(link_id)',
    );
    expect(mock.chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('returns subscriptions with strategy link_ids', async () => {
    const now = '2024-01-15T10:00:00Z';
    mock.chain.eq.mockResolvedValueOnce({
      data: [
        {
          user_id: 'user-1',
          strategy_id: 42,
          account_id: 'acct-1',
          created_at: now,
          updated_at: now,
          strategy: { link_id: 'link-abc' },
        },
        {
          user_id: 'user-1',
          strategy_id: 99,
          account_id: null,
          created_at: now,
          updated_at: now,
          strategy: { link_id: 'link-def' },
        },
      ],
      error: null,
    });

    const result = await listByUser(mock.client, 'user-1');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      userId: 'user-1',
      strategyId: 42,
      strategyLinkId: 'link-abc',
      accountId: 'acct-1',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
    expect(result[1]).toEqual({
      userId: 'user-1',
      strategyId: 99,
      strategyLinkId: 'link-def',
      accountId: null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
  });

  it('filters out rows with missing required fields', async () => {
    const now = '2024-01-15T10:00:00Z';
    mock.chain.eq.mockResolvedValueOnce({
      data: [
        {
          user_id: 'user-1',
          strategy_id: 42,
          account_id: null,
          created_at: now,
          updated_at: now,
          strategy: { link_id: 'link-abc' },
        },
        {
          user_id: null,
          strategy_id: 99,
          account_id: null,
          created_at: now,
          updated_at: now,
          strategy: { link_id: 'link-def' },
        },
      ],
      error: null,
    });

    const result = await listByUser(mock.client, 'user-1');

    expect(result).toHaveLength(1);
    expect(result[0].strategyLinkId).toBe('link-abc');
  });

  it('throws on query error', async () => {
    mock.chain.eq.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection failed' },
    });

    await expect(listByUser(mock.client, 'user-1')).rejects.toThrow(
      'Failed to fetch subscriptions: connection failed',
    );
  });

  it('returns empty array for null data', async () => {
    mock.chain.eq.mockResolvedValueOnce({ data: null, error: null });

    const result = await listByUser(mock.client, 'user-1');

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getByUserAndStrategy
// ---------------------------------------------------------------------------

describe('getByUserAndStrategy', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
  });

  it('returns subscription when found', async () => {
    const now = '2024-01-15T10:00:00Z';

    // strategies lookup
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({ data: { id: 42 }, error: null });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    // subscriptions lookup
    const subscriptionsChain: Record<string, ReturnType<typeof vi.fn>> = {};
    subscriptionsChain.single = vi.fn().mockResolvedValue({
      data: {
        user_id: 'user-1',
        strategy_id: 42,
        account_id: 'acct-1',
        created_at: now,
        updated_at: now,
      },
      error: null,
    });
    subscriptionsChain.eq = vi.fn().mockReturnValue(subscriptionsChain);
    subscriptionsChain.select = vi.fn().mockReturnValue(subscriptionsChain);

    mock.from
      .mockReturnValueOnce(strategiesChain)
      .mockReturnValueOnce(subscriptionsChain);

    const result = await getByUserAndStrategy(mock.client, 'user-1', 'link-abc');

    expect(result).toEqual({
      userId: 'user-1',
      strategyId: 42,
      strategyLinkId: 'link-abc',
      accountId: 'acct-1',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
  });

  it('returns null when strategy not found (PGRST116)', async () => {
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'not found', code: 'PGRST116' },
    });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    mock.from.mockReturnValueOnce(strategiesChain);

    const result = await getByUserAndStrategy(mock.client, 'user-1', 'link-missing');

    expect(result).toBeNull();
  });

  it('throws when strategy lookup fails with non-PGRST116 error', async () => {
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'db error', code: 'INTERNAL' },
    });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    mock.from.mockReturnValueOnce(strategiesChain);

    await expect(getByUserAndStrategy(mock.client, 'user-1', 'link-abc')).rejects.toThrow(
      'Failed to fetch strategy: db error',
    );
  });

  it('returns null when subscription not found (PGRST116)', async () => {
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({ data: { id: 42 }, error: null });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    const subscriptionsChain: Record<string, ReturnType<typeof vi.fn>> = {};
    subscriptionsChain.single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'not found', code: 'PGRST116' },
    });
    subscriptionsChain.eq = vi.fn().mockReturnValue(subscriptionsChain);
    subscriptionsChain.select = vi.fn().mockReturnValue(subscriptionsChain);

    mock.from
      .mockReturnValueOnce(strategiesChain)
      .mockReturnValueOnce(subscriptionsChain);

    const result = await getByUserAndStrategy(mock.client, 'user-1', 'link-abc');

    expect(result).toBeNull();
  });

  it('throws when subscription lookup fails with non-PGRST116 error', async () => {
    const strategiesChain: Record<string, ReturnType<typeof vi.fn>> = {};
    strategiesChain.single = vi.fn().mockResolvedValue({ data: { id: 42 }, error: null });
    strategiesChain.eq = vi.fn().mockReturnValue(strategiesChain);
    strategiesChain.select = vi.fn().mockReturnValue(strategiesChain);

    const subscriptionsChain: Record<string, ReturnType<typeof vi.fn>> = {};
    subscriptionsChain.single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'timeout', code: 'INTERNAL' },
    });
    subscriptionsChain.eq = vi.fn().mockReturnValue(subscriptionsChain);
    subscriptionsChain.select = vi.fn().mockReturnValue(subscriptionsChain);

    mock.from
      .mockReturnValueOnce(strategiesChain)
      .mockReturnValueOnce(subscriptionsChain);

    await expect(getByUserAndStrategy(mock.client, 'user-1', 'link-abc')).rejects.toThrow(
      'Failed to fetch subscription: timeout',
    );
  });
});

// ---------------------------------------------------------------------------
// countByUser
// ---------------------------------------------------------------------------

describe('countByUser', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
  });

  it('returns count', async () => {
    mock.chain.eq.mockResolvedValueOnce({ count: 5, error: null });

    const result = await countByUser(mock.client, 'user-1');

    expect(result).toBe(5);
    expect(mock.from).toHaveBeenCalledWith('subscriptions');
    expect(mock.chain.select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(mock.chain.eq).toHaveBeenCalledWith('user_id', 'user-1');
  });

  it('returns 0 when count is null', async () => {
    mock.chain.eq.mockResolvedValueOnce({ count: null, error: null });

    const result = await countByUser(mock.client, 'user-1');

    expect(result).toBe(0);
  });

  it('throws on error', async () => {
    mock.chain.eq.mockResolvedValueOnce({
      count: null,
      error: { message: 'db error' },
    });

    await expect(countByUser(mock.client, 'user-1')).rejects.toThrow(
      'Failed to count subscriptions: db error',
    );
  });
});

// ---------------------------------------------------------------------------
// listAll
// ---------------------------------------------------------------------------

describe('listAll', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
  });

  it('returns all subscriptions with emails', async () => {
    const now = '2024-01-15T10:00:00Z';
    mock.chain.select.mockResolvedValueOnce({
      data: [
        {
          user_id: 'user-1',
          strategy_id: 42,
          email: 'a@b.com',
          account_id: 'acct-1',
          created_at: now,
          updated_at: now,
          strategy: { link_id: 'link-abc' },
        },
      ],
      error: null,
    });

    const result = await listAll(mock.client);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      userId: 'user-1',
      strategyId: 42,
      strategyLinkId: 'link-abc',
      email: 'a@b.com',
      accountId: 'acct-1',
      createdAt: new Date(now),
      updatedAt: new Date(now),
    });
    expect(mock.from).toHaveBeenCalledWith('subscriptions_with_email');
    expect(mock.chain.select).toHaveBeenCalledWith(
      'user_id, strategy_id, email, account_id, created_at, updated_at, strategy:strategies(link_id)',
    );
  });

  it('returns empty array when no data', async () => {
    mock.chain.select.mockResolvedValueOnce({ data: [], error: null });

    const result = await listAll(mock.client);

    expect(result).toEqual([]);
  });

  it('returns empty array for null data', async () => {
    mock.chain.select.mockResolvedValueOnce({ data: null, error: null });

    const result = await listAll(mock.client);

    expect(result).toEqual([]);
  });

  it('filters out rows with missing required fields', async () => {
    const now = '2024-01-15T10:00:00Z';
    mock.chain.select.mockResolvedValueOnce({
      data: [
        {
          user_id: 'user-1',
          strategy_id: 42,
          email: 'a@b.com',
          account_id: null,
          created_at: now,
          updated_at: now,
          strategy: { link_id: 'link-abc' },
        },
        {
          user_id: 'user-2',
          strategy_id: 99,
          email: null,
          account_id: null,
          created_at: now,
          updated_at: now,
          strategy: { link_id: 'link-def' },
        },
      ],
      error: null,
    });

    const result = await listAll(mock.client);

    expect(result).toHaveLength(1);
    expect(result[0].email).toBe('a@b.com');
  });

  it('throws on query error', async () => {
    mock.chain.select.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied' },
    });

    await expect(listAll(mock.client)).rejects.toThrow(
      'Failed to fetch subscriptions: permission denied',
    );
  });
});

// ---------------------------------------------------------------------------
// listApprovedAutoDeployUserIds
// ---------------------------------------------------------------------------

describe('listApprovedAutoDeployUserIds', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
  });

  it('returns Set of user_ids', async () => {
    mock.chain.select.mockResolvedValueOnce({
      data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
      error: null,
    });

    const result = await listApprovedAutoDeployUserIds(mock.client);

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(2);
    expect(result.has('user-1')).toBe(true);
    expect(result.has('user-2')).toBe(true);
    expect(mock.from).toHaveBeenCalledWith('autodeploy_slots');
    expect(mock.chain.select).toHaveBeenCalledWith('user_id');
  });

  it('returns empty Set when no slots', async () => {
    mock.chain.select.mockResolvedValueOnce({ data: [], error: null });

    const result = await listApprovedAutoDeployUserIds(mock.client);

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it('returns empty Set for null data', async () => {
    mock.chain.select.mockResolvedValueOnce({ data: null, error: null });

    const result = await listApprovedAutoDeployUserIds(mock.client);

    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it('throws on query error', async () => {
    mock.chain.select.mockResolvedValueOnce({
      data: null,
      error: { message: 'table not found' },
    });

    await expect(listApprovedAutoDeployUserIds(mock.client)).rejects.toThrow(
      'Failed to fetch autodeploy slots: table not found',
    );
  });
});
