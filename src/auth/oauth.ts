import type { OAuthTokens, PKCEPair, AuthorizeUrlOptions } from './types';

// ---------------------------------------------------------------------------
// PKCE generation (pure, no network — uses Web Crypto API)
// ---------------------------------------------------------------------------

function base64URLEncode(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generatePKCE(): PKCEPair {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = base64URLEncode(array);

  // Use synchronous SHA-256 via Node.js crypto for compatibility
  // Falls back to a synchronous approach using Node.js built-in
  const { createHash } = require('crypto');
  const hash = createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = base64URLEncode(new Uint8Array(hash));

  return { codeVerifier, codeChallenge };
}

// ---------------------------------------------------------------------------
// Authorization URL builder
// ---------------------------------------------------------------------------

export function buildAuthorizationUrl(
  supabaseUrl: string,
  options: AuthorizeUrlOptions,
): { url: string; pkce: PKCEPair } {
  const pkce = generatePKCE();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: 'S256',
    scope: options.scope ?? 'openid email',
  });
  if (options.state) params.set('state', options.state);
  if (options.nonce) params.set('nonce', options.nonce);
  return { url: `${supabaseUrl}/auth/v1/oauth/authorize?${params}`, pkce };
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export async function exchangeCodeForTokens(
  supabaseUrl: string,
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const response = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    tokenType: 'bearer',
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token,
    scope: data.scope,
    ...(data.id_token ? { idToken: data.id_token } : {}),
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshAccessToken(
  supabaseUrl: string,
  refreshToken: string,
  clientId: string,
): Promise<OAuthTokens> {
  const response = await fetch(`${supabaseUrl}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    tokenType: 'bearer',
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token,
    scope: data.scope,
    ...(data.id_token ? { idToken: data.id_token } : {}),
  };
}
