import type { TypedSupabaseClient } from '../types';
import type { AutumnAttachResponse, AutumnPortalResponse } from './types';
import { autumnFetch } from './autumn';

async function requireUserId(supabase: TypedSupabaseClient): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

export async function getCheckoutUrl(
  supabase: TypedSupabaseClient,
  plan: string,
  successUrl: string,
): Promise<string> {
  const userId = await requireUserId(supabase);

  const result = await autumnFetch<AutumnAttachResponse>({
    method: 'POST',
    path: '/v1/billing.attach',
    body: {
      customer_id: userId,
      product_id: plan,
      success_url: successUrl,
    },
  });

  if (!result.payment_url) {
    throw new Error('No payment URL returned — user may already be on this plan');
  }

  return result.payment_url;
}

export async function getPortalUrl(supabase: TypedSupabaseClient, returnUrl: string): Promise<string> {
  const userId = await requireUserId(supabase);

  const result = await autumnFetch<AutumnPortalResponse>({
    method: 'POST',
    path: '/v1/billing.open_customer_portal',
    body: {
      customer_id: userId,
      return_url: returnUrl,
    },
  });

  return result.url;
}

export async function cancel(supabase: TypedSupabaseClient, productId: string): Promise<void> {
  const userId = await requireUserId(supabase);

  await autumnFetch<unknown>({
    method: 'POST',
    path: '/v1/billing.update',
    body: {
      customer_id: userId,
      product_id: productId,
      cancel_immediately: false,
    },
  });
}

export async function reinstate(supabase: TypedSupabaseClient, productId: string): Promise<void> {
  const userId = await requireUserId(supabase);

  await autumnFetch<unknown>({
    method: 'POST',
    path: '/v1/billing.update',
    body: {
      customer_id: userId,
      product_id: productId,
      cancel_action: 'uncancel',
    },
  });
}
