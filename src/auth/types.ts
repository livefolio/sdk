import type { User, Session, AuthChangeEvent, Subscription } from '@supabase/supabase-js';

export interface AuthModule {
  getUser(): Promise<User | null>;
  getSession(): Promise<Session | null>;
  requireUser(): Promise<User>;
  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: Session | null) => void,
  ): Subscription;
  signOut(): Promise<void>;
}
