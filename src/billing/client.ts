import type { TypedSupabaseClient } from '../types';
import type { BillingModule } from './types';
import { checkEntitlement, getTier, getLimit } from './entitlement';
import { getCheckoutUrl, getPortalUrl, cancel, reinstate } from './checkout';

export function createBilling(supabase: TypedSupabaseClient): BillingModule {
  return {
    checkEntitlement: (feature) => checkEntitlement(supabase, feature),
    getTier: () => getTier(supabase),
    getLimit: (resource) => getLimit(supabase, resource),
    getCheckoutUrl: (plan, successUrl) => getCheckoutUrl(supabase, plan, successUrl),
    getPortalUrl: (returnUrl) => getPortalUrl(supabase, returnUrl),
    cancel: (productId) => cancel(supabase, productId),
    reinstate: (productId) => reinstate(supabase, productId),
  };
}
