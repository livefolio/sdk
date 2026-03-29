import type { SupabaseClient } from '@supabase/supabase-js';

// TODO: replace with SupabaseClient<Database> when @livefolio/db v2 is available
export type TypedSupabaseClient = SupabaseClient<any>;
