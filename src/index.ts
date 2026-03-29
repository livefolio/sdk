import type { LivefolioClientOptions, LivefolioClient } from './types.js';

export type { LivefolioClientOptions, LivefolioClient, TypedSupabaseClient } from './types.js';

export function createClient(options: LivefolioClientOptions): LivefolioClient {
  const _supabase = options.supabase;
  return {};
}
