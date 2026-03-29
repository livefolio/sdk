import type { User, Session } from '@supabase/supabase-js';

export type { User, Session } from '@supabase/supabase-js';

export interface AuthModule {
  /** Returns the current user, or null if not authenticated.
   *  Returns null for both "not authenticated" AND Supabase errors —
   *  trades error granularity for API simplicity. */
  getUser(): Promise<User | null>;
  /** Returns the current session, or null if no active session.
   *  Returns null for both "no session" AND Supabase errors. */
  getSession(): Promise<Session | null>;
  /** Signs out the current user. Throws on Supabase error. */
  signOut(): Promise<void>;
}
