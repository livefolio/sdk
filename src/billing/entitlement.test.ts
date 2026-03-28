import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkEntitlement, getTier, getLimit } from './entitlement';
import type { TypedSupabaseClient } from '../types';

vi.mock('./autumn', () => ({
  autumnFetch: vi.fn(),
}));

import { autumnFetch } from './autumn';
const mockAutumnFetch = vi.mocked(autumnFetch);

function mockSupabase(userId: string | null): TypedSupabaseClient {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId } : null },
        error: null,
      }),
    },
  } as unknown as TypedSupabaseClient;
}

describe('checkEntitlement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false when user is not authenticated', async () => {
    const result = await checkEntitlement(mockSupabase(null), 'pro');
    expect(result).toBe(false);
    expect(mockAutumnFetch).not.toHaveBeenCalled();
  });

  it('returns true when Autumn allows the feature', async () => {
    mockAutumnFetch.mockResolvedValue({ allowed: true });
    const result = await checkEntitlement(mockSupabase('user-1'), 'pro');
    expect(result).toBe(true);
    expect(mockAutumnFetch).toHaveBeenCalledWith({
      method: 'GET',
      path: '/entitled',
      params: { customer_id: 'user-1', feature_id: 'pro' },
    });
  });

  it('returns false when Autumn denies the feature', async () => {
    mockAutumnFetch.mockResolvedValue({ allowed: false });
    const result = await checkEntitlement(mockSupabase('user-1'), 'pro');
    expect(result).toBe(false);
  });
});

describe('getTier', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns anonymous when user is not authenticated', async () => {
    const result = await getTier(mockSupabase(null));
    expect(result).toBe('anonymous');
  });

  it('returns pro when user has pro entitlement', async () => {
    mockAutumnFetch.mockResolvedValue({ allowed: true });
    const result = await getTier(mockSupabase('user-1'));
    expect(result).toBe('pro');
  });

  it('returns free when user lacks pro entitlement', async () => {
    mockAutumnFetch.mockResolvedValue({ allowed: false });
    const result = await getTier(mockSupabase('user-1'));
    expect(result).toBe('free');
  });
});

describe('getLimit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0 when user is not authenticated', async () => {
    const result = await getLimit(mockSupabase(null), 'strategies');
    expect(result).toBe(0);
  });

  it('returns balance from Autumn', async () => {
    mockAutumnFetch.mockResolvedValue({ allowed: true, balance: 5 });
    const result = await getLimit(mockSupabase('user-1'), 'strategies');
    expect(result).toBe(5);
  });

  it('returns 0 when balance is not present', async () => {
    mockAutumnFetch.mockResolvedValue({ allowed: true });
    const result = await getLimit(mockSupabase('user-1'), 'strategies');
    expect(result).toBe(0);
  });
});
