import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCheckoutUrl, getPortalUrl, cancel, reinstate } from './checkout';
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

describe('getCheckoutUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when user is not authenticated', async () => {
    await expect(getCheckoutUrl(mockSupabase(null), 'pro', '/success')).rejects.toThrow('Not authenticated');
  });

  it('returns payment URL from Autumn attach', async () => {
    mockAutumnFetch.mockResolvedValue({ payment_url: 'https://checkout.stripe.com/session123' });
    const url = await getCheckoutUrl(mockSupabase('user-1'), 'pro', '/success');
    expect(url).toBe('https://checkout.stripe.com/session123');
    expect(mockAutumnFetch).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/billing.attach',
      body: { customer_id: 'user-1', product_id: 'pro', success_url: '/success' },
    });
  });

  it('throws when no payment URL returned', async () => {
    mockAutumnFetch.mockResolvedValue({ customer_id: 'user-1' });
    await expect(getCheckoutUrl(mockSupabase('user-1'), 'pro', '/success')).rejects.toThrow(
      'No payment URL returned',
    );
  });
});

describe('getPortalUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when user is not authenticated', async () => {
    await expect(getPortalUrl(mockSupabase(null), '/settings')).rejects.toThrow('Not authenticated');
  });

  it('returns portal URL from Autumn', async () => {
    mockAutumnFetch.mockResolvedValue({ url: 'https://billing.stripe.com/portal123' });
    const url = await getPortalUrl(mockSupabase('user-1'), '/settings');
    expect(url).toBe('https://billing.stripe.com/portal123');
    expect(mockAutumnFetch).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/billing.open_customer_portal',
      body: { customer_id: 'user-1', return_url: '/settings' },
    });
  });
});

describe('cancel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when user is not authenticated', async () => {
    await expect(cancel(mockSupabase(null), 'pro')).rejects.toThrow('Not authenticated');
  });

  it('calls Autumn billing.update with cancel', async () => {
    mockAutumnFetch.mockResolvedValue({});
    await cancel(mockSupabase('user-1'), 'pro');
    expect(mockAutumnFetch).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/billing.update',
      body: { customer_id: 'user-1', product_id: 'pro', cancel_immediately: false },
    });
  });
});

describe('reinstate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when user is not authenticated', async () => {
    await expect(reinstate(mockSupabase(null), 'pro')).rejects.toThrow('Not authenticated');
  });

  it('calls Autumn billing.update with uncancel', async () => {
    mockAutumnFetch.mockResolvedValue({});
    await reinstate(mockSupabase('user-1'), 'pro');
    expect(mockAutumnFetch).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/billing.update',
      body: { customer_id: 'user-1', product_id: 'pro', cancel_action: 'uncancel' },
    });
  });
});
