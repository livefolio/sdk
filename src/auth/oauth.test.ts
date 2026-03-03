import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePKCE, buildAuthorizationUrl, exchangeCodeForTokens, refreshAccessToken } from './oauth';
import { createAuth } from './client';

describe('generatePKCE', () => {
  it('produces a valid code verifier (43-128 URL-safe chars)', () => {
    const { codeVerifier } = generatePKCE();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces a valid S256 code challenge', () => {
    const { codeChallenge } = generatePKCE();
    expect(codeChallenge.length).toBeGreaterThan(0);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces different values on each call', () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe('buildAuthorizationUrl', () => {
  it('builds correct URL with all required params', () => {
    const { url, pkce } = buildAuthorizationUrl('https://abc.supabase.co', {
      clientId: 'my-cli',
      redirectUri: 'http://localhost:9999/callback',
    });

    expect(url).toContain('https://abc.supabase.co/auth/v1/oauth/authorize?');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('my-cli');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:9999/callback');
    expect(parsed.searchParams.get('code_challenge')).toBe(pkce.codeChallenge);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('scope')).toBe('openid email');
  });

  it('includes optional state and nonce', () => {
    const { url } = buildAuthorizationUrl('https://abc.supabase.co', {
      clientId: 'my-cli',
      redirectUri: 'http://localhost:9999/callback',
      state: 'csrf-token',
      nonce: 'replay-nonce',
      scope: 'openid profile',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('state')).toBe('csrf-token');
    expect(parsed.searchParams.get('nonce')).toBe('replay-nonce');
    expect(parsed.searchParams.get('scope')).toBe('openid profile');
  });
});

describe('exchangeCodeForTokens', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns tokens on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'at-123',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'rt-456',
        scope: 'openid email',
        id_token: 'idt-789',
      }),
    });

    const tokens = await exchangeCodeForTokens(
      'https://abc.supabase.co',
      'auth-code',
      'verifier',
      'my-cli',
      'http://localhost:9999/callback',
    );

    expect(tokens).toEqual({
      accessToken: 'at-123',
      tokenType: 'bearer',
      expiresIn: 3600,
      refreshToken: 'rt-456',
      scope: 'openid email',
      idToken: 'idt-789',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://abc.supabase.co/auth/v1/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'invalid_grant',
    });

    await expect(
      exchangeCodeForTokens('https://abc.supabase.co', 'bad-code', 'v', 'c', 'r'),
    ).rejects.toThrow('Token exchange failed (400): invalid_grant');
  });
});

describe('refreshAccessToken', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns refreshed tokens', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-at',
        token_type: 'bearer',
        expires_in: 3600,
        refresh_token: 'new-rt',
        scope: 'openid email',
      }),
    });

    const tokens = await refreshAccessToken(
      'https://abc.supabase.co',
      'old-rt',
      'my-cli',
    );

    expect(tokens.accessToken).toBe('new-at');
    expect(tokens.refreshToken).toBe('new-rt');
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'invalid_token',
    });

    await expect(
      refreshAccessToken('https://abc.supabase.co', 'bad-rt', 'c'),
    ).rejects.toThrow('Token refresh failed (401): invalid_token');
  });
});

describe('createAuth OAuth methods', () => {
  it('throws when supabaseUrl not configured', () => {
    const client = { auth: {} } as any;
    const auth = createAuth(client);

    expect(() => auth.buildAuthorizationUrl({ clientId: 'x', redirectUri: 'x' })).toThrow(
      'supabaseUrl is required for OAuth operations',
    );
  });

  it('revokeGrant delegates to supabase client', async () => {
    const mockRevokeGrant = vi.fn().mockResolvedValue(undefined);
    const client = {
      auth: {
        oauth: { revokeGrant: mockRevokeGrant },
      },
    } as any;
    const auth = createAuth(client);

    await auth.revokeGrant('my-cli');
    expect(mockRevokeGrant).toHaveBeenCalledWith('my-cli');
  });

  it('revokeGrant throws when oauth.revokeGrant not available', async () => {
    const client = { auth: {} } as any;
    const auth = createAuth(client);

    await expect(auth.revokeGrant('my-cli')).rejects.toThrow(
      'supabase.auth.oauth.revokeGrant() is not available',
    );
  });
});
