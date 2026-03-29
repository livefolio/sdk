import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { LivefolioClientOptions } from './types.js';

export type { LivefolioClientOptions } from './types.js';

export interface LivefolioClient {}

export function createClient(options: LivefolioClientOptions): LivefolioClient {
  const _supabase = createSupabaseClient(options.supabaseUrl, options.supabaseKey);
  return {};
}
