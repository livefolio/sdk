import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@livefolio/db';

export type TypedSupabaseClient = SupabaseClient<Database>;
