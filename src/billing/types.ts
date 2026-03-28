export type UserTier = 'anonymous' | 'free' | 'pro';

export interface BillingModule {
  /** Check if the current user has access to a feature */
  checkEntitlement(feature: string): Promise<boolean>;
  /** Get the current user's billing tier */
  getTier(): Promise<UserTier>;
  /** Get the current user's limit for a metered resource */
  getLimit(resource: string): Promise<number>;
  /** Get a checkout URL for upgrading to a plan */
  getCheckoutUrl(plan: string, successUrl: string): Promise<string>;
  /** Get the Autumn customer portal URL for billing management */
  getPortalUrl(returnUrl: string): Promise<string>;
  /** Cancel the current user's subscription (end of billing cycle) */
  cancel(productId: string): Promise<void>;
  /** Reinstate a cancelled subscription before period end */
  reinstate(productId: string): Promise<void>;
}

/** Response from Autumn entitled endpoint */
export interface AutumnEntitlementResponse {
  allowed: boolean;
  balance?: number;
}

/** Response from Autumn billing.attach endpoint */
export interface AutumnAttachResponse {
  payment_url?: string;
  customer_id?: string;
  required_action?: string;
}

/** Response from Autumn billing.open_customer_portal endpoint */
export interface AutumnPortalResponse {
  url: string;
}
