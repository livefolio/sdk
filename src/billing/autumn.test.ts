import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { autumnFetch } from './autumn';

describe('autumnFetch', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AUTUMN_SECRET_KEY = 'test-secret';
    delete process.env.AUTUMN_API_URL;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('throws when AUTUMN_SECRET_KEY is missing', async () => {
    delete process.env.AUTUMN_SECRET_KEY;
    await expect(autumnFetch({ method: 'GET', path: '/entitled' })).rejects.toThrow(
      'AUTUMN_SECRET_KEY environment variable is required',
    );
  });

  it('makes GET request with params and auth header', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ allowed: true }), { status: 200 }));

    const result = await autumnFetch({
      method: 'GET',
      path: '/entitled',
      params: { customer_id: 'user-1', feature_id: 'pro' },
    });

    expect(result).toEqual({ allowed: true });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.useautumn.com/entitled?customer_id=user-1&feature_id=pro',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' },
      }),
    );
  });

  it('makes POST request with body', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ payment_url: 'https://example.com' }), { status: 200 }));

    await autumnFetch({
      method: 'POST',
      path: '/v1/billing.attach',
      body: { customer_id: 'user-1', product_id: 'pro' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.useautumn.com/v1/billing.attach',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ customer_id: 'user-1', product_id: 'pro' }),
      }),
    );
  });

  it('uses AUTUMN_API_URL when set', async () => {
    process.env.AUTUMN_API_URL = 'https://staging.autumn.dev';
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await autumnFetch({ method: 'GET', path: '/entitled' });

    expect(mockFetch).toHaveBeenCalledWith('https://staging.autumn.dev/entitled', expect.anything());
  });

  it('throws on non-ok response with error details', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' }));

    await expect(autumnFetch({ method: 'GET', path: '/entitled' })).rejects.toThrow(
      'Autumn API GET /entitled: 404 Not Found — Not Found',
    );
  });
});
