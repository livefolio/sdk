import type { User, Session, AuthChangeEvent, Subscription } from '@supabase/supabase-js';
import type { TypedSupabaseClient } from '../types';

export interface AuthModule {
  getUser(): Promise<User | null>;
  getSession(): Promise<Session | null>;
  requireUser(): Promise<User>;
  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void,
  ): Subscription;
  signOut(): Promise<void>;
}

export function createAuth(client: TypedSupabaseClient): AuthModule {
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
  };
}
