import type { TypedSupabaseClient } from '../types.js';
import type { AuthModule } from './types.js';

export function createAuth(supabase: TypedSupabaseClient): AuthModule {
  return {
    async getUser() {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
    async getSession() {
      const { data: { session } } = await supabase.auth.getSession();
      return session;
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  };
}
