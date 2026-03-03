import type { User, Session, AuthChangeEvent, Subscription } from '@supabase/supabase-js';

export interface OAuthTokens {
  accessToken: string;
  tokenType: 'bearer';
  expiresIn: number;
  refreshToken: string;
  scope: string;
  idToken?: string;
}

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface AuthorizeUrlOptions {
  clientId: string;
  redirectUri: string;
  scope?: string;
  state?: string;
  nonce?: string;
}

export interface AuthModule {
  // Existing (Supabase session-based)
  getUser(): Promise<User | null>;
  getSession(): Promise<Session | null>;
  requireUser(): Promise<User>;
  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void,
  ): Subscription;
  signOut(): Promise<void>;

  // OAuth 2.1 PKCE (token-based, for CLI/agents)
  generatePKCE(): PKCEPair;
  buildAuthorizationUrl(options: AuthorizeUrlOptions): { url: string; pkce: PKCEPair };
  exchangeCodeForTokens(code: string, codeVerifier: string, clientId: string, redirectUri: string): Promise<OAuthTokens>;
  refreshAccessToken(refreshToken: string, clientId: string): Promise<OAuthTokens>;
  revokeGrant(clientId: string): Promise<void>;
}
