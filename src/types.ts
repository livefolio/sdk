import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthModule } from './auth/types.js';

// TODO: replace with SupabaseClient<Database> when @livefolio/db v2 is available
export type TypedSupabaseClient = SupabaseClient<any>;

export interface LivefolioClientOptions {
  supabaseUrl: string;
  supabaseKey: string;
}

export interface LivefolioClient {
  readonly auth: AuthModule;
}
