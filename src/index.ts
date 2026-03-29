import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { LivefolioClientOptions, LivefolioClient } from './types.js';
import { createAuth } from './auth/client.js';

export type { LivefolioClientOptions, LivefolioClient } from './types.js';
export type { AuthModule, User, Session } from './auth/types.js';

export function createClient(options: LivefolioClientOptions): LivefolioClient {
  const supabase = createSupabaseClient(options.supabaseUrl, options.supabaseKey);
  const auth = createAuth(supabase);
  return { auth };
}
