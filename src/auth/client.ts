import type { TypedSupabaseClient } from '../types';
import type { LivefolioClientConfig } from '../types';
import type { AuthModule } from './types';
import {
  generatePKCE as generatePKCEPure,
  buildAuthorizationUrl as buildAuthorizationUrlPure,
  exchangeCodeForTokens as exchangeCodeForTokensPure,
  refreshAccessToken as refreshAccessTokenPure,
} from './oauth';

function requireSupabaseUrl(config?: LivefolioClientConfig): string {
  const url = config?.supabaseUrl;
  if (!url) throw new Error('supabaseUrl is required for OAuth operations');
  return url;
}

export function createAuth(client: TypedSupabaseClient, config?: LivefolioClientConfig): AuthModule {
  return {
    async getUser() {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      return data.user;
    },

    async getSession() {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      return data.session;
    },

    async requireUser() {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      if (!data.user) throw new Error('Not authenticated');
      return data.user;
    },

    onAuthStateChange(callback) {
      const { data } = client.auth.onAuthStateChange(callback);
      return data.subscription;
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },

    // ----- OAuth 2.1 PKCE -----

    generatePKCE() {
      return generatePKCEPure();
    },

    buildAuthorizationUrl(options) {
      const supabaseUrl = requireSupabaseUrl(config);
      return buildAuthorizationUrlPure(supabaseUrl, options);
    },

    async exchangeCodeForTokens(code, codeVerifier, clientId, redirectUri) {
      const supabaseUrl = requireSupabaseUrl(config);
      return exchangeCodeForTokensPure(supabaseUrl, code, codeVerifier, clientId, redirectUri);
    },

    async refreshAccessToken(refreshToken, clientId) {
      const supabaseUrl = requireSupabaseUrl(config);
      return refreshAccessTokenPure(supabaseUrl, refreshToken, clientId);
    },

    async revokeGrant(clientId) {
      const auth = client.auth as any;
      if (typeof auth.oauth?.revokeGrant !== 'function') {
        throw new Error('supabase.auth.oauth.revokeGrant() is not available — upgrade @supabase/supabase-js');
      }
      await auth.oauth.revokeGrant(clientId);
    },
  };
}
