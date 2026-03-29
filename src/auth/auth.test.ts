import { describe, it, expect, vi } from 'vitest';
import { createAuth } from './client.js';
import type { TypedSupabaseClient } from '../types.js';

function mockSupabase(overrides: {
  getUser?: () => Promise<any>;
  getSession?: () => Promise<any>;
  signOut?: () => Promise<any>;
} = {}): TypedSupabaseClient {
  return {
    auth: {
      getUser: overrides.getUser ?? vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@example.com' } },
        error: null,
      }),
      getSession: overrides.getSession ?? vi.fn().mockResolvedValue({
        data: { session: { access_token: 'token-1', user: { id: 'user-1' } } },
        error: null,
      }),
      signOut: overrides.signOut ?? vi.fn().mockResolvedValue({ error: null }),
    },
  } as unknown as TypedSupabaseClient;
}

describe('createAuth', () => {
  describe('getUser', () => {
    it('returns the user when authenticated', async () => {
      const supabase = mockSupabase();
      const auth = createAuth(supabase);
      const user = await auth.getUser();
      expect(user).toEqual({ id: 'user-1', email: 'test@example.com' });
    });

    it('returns null when not authenticated', async () => {
      const supabase = mockSupabase({
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      });
      const auth = createAuth(supabase);
      const user = await auth.getUser();
      expect(user).toBeNull();
    });

    it('returns null when Supabase returns an error', async () => {
      const supabase = mockSupabase({
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'Auth service unavailable' },
        }),
      });
      const auth = createAuth(supabase);
      const user = await auth.getUser();
      expect(user).toBeNull();
    });
  });

  describe('getSession', () => {
    it('returns the session when active', async () => {
      const supabase = mockSupabase();
      const auth = createAuth(supabase);
      const session = await auth.getSession();
      expect(session).toEqual({ access_token: 'token-1', user: { id: 'user-1' } });
    });

    it('returns null when no session exists', async () => {
      const supabase = mockSupabase({
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
      });
      const auth = createAuth(supabase);
      const session = await auth.getSession();
      expect(session).toBeNull();
    });

    it('returns null when Supabase returns an error', async () => {
      const supabase = mockSupabase({
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: { message: 'Auth service unavailable' },
        }),
      });
      const auth = createAuth(supabase);
      const session = await auth.getSession();
      expect(session).toBeNull();
    });
  });

  describe('signOut', () => {
    it('signs out successfully', async () => {
      const supabase = mockSupabase();
      const auth = createAuth(supabase);
      await expect(auth.signOut()).resolves.toBeUndefined();
      expect(supabase.auth.signOut).toHaveBeenCalled();
    });

    it('throws when Supabase returns an error', async () => {
      const error = { message: 'Sign out failed', status: 500 };
      const supabase = mockSupabase({
        signOut: vi.fn().mockResolvedValue({ error }),
      });
      const auth = createAuth(supabase);
      await expect(auth.signOut()).rejects.toEqual(error);
    });
  });
});
