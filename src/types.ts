import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@livefolio/db';

export type TypedSupabaseClient = SupabaseClient<Database>;

export interface SnapTradeConfig {
  clientId: string;
  consumerKey: string;
  /** Base64-encoded 32-byte AES key for encrypting/decrypting user secrets */
  secretEncryptionKey: string;
  basePath?: string;
  timeoutMs?: number;
}

export interface LivefolioClientConfig {
  /** Supabase project URL, e.g. "https://abc.supabase.co" — required for OAuth */
  supabaseUrl?: string;
  snaptrade?: SnapTradeConfig;
}
