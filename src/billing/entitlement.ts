import type { TypedSupabaseClient } from '../types';
import type { UserTier, AutumnEntitlementResponse } from './types';
import { autumnFetch } from './autumn';

async function getUserId(supabase: TypedSupabaseClient): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function checkEntitlement(supabase: TypedSupabaseClient, feature: string): Promise<boolean> {
  const userId = await getUserId(supabase);
  if (!userId) return false;

  const result = await autumnFetch<AutumnEntitlementResponse>({
    method: 'GET',
    path: '/entitled',
    params: { customer_id: userId, feature_id: feature },
  });

  return result.allowed;
}

export async function getTier(supabase: TypedSupabaseClient): Promise<UserTier> {
  const userId = await getUserId(supabase);
  if (!userId) return 'anonymous';

  const result = await autumnFetch<AutumnEntitlementResponse>({
    method: 'GET',
    path: '/entitled',
    params: { customer_id: userId, feature_id: 'pro' },
  });

  return result.allowed ? 'pro' : 'free';
}

export async function getLimit(supabase: TypedSupabaseClient, resource: string): Promise<number> {
  const userId = await getUserId(supabase);
  if (!userId) return 0;

  const result = await autumnFetch<AutumnEntitlementResponse>({
    method: 'GET',
    path: '/entitled',
    params: { customer_id: userId, feature_id: resource },
  });

  return result.balance ?? 0;
}
