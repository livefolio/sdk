import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

export type { Database };

export type TypedSupabaseClient = SupabaseClient<Database>;
