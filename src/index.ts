import type { TypedSupabaseClient } from './types.js';

export type { TypedSupabaseClient } from './types.js';

export interface LivefolioClient {}

export function createClient(_supabase: TypedSupabaseClient): LivefolioClient {
  return {};
}
