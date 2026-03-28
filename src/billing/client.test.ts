import { describe, it, expect, vi } from 'vitest';
import { createBilling } from './client';
import type { TypedSupabaseClient } from '../types';

vi.mock('./entitlement', () => ({
  checkEntitlement: vi.fn(),
  getTier: vi.fn(),
  getLimit: vi.fn(),
}));
vi.mock('./checkout', () => ({
  getCheckoutUrl: vi.fn(),
  getPortalUrl: vi.fn(),
  cancel: vi.fn(),
  reinstate: vi.fn(),
}));

describe('createBilling', () => {
  const supabase = {} as TypedSupabaseClient;
  const billing = createBilling(supabase);

  it('exposes all BillingModule methods', () => {
    expect(typeof billing.checkEntitlement).toBe('function');
    expect(typeof billing.getTier).toBe('function');
    expect(typeof billing.getLimit).toBe('function');
    expect(typeof billing.getCheckoutUrl).toBe('function');
    expect(typeof billing.getPortalUrl).toBe('function');
    expect(typeof billing.cancel).toBe('function');
    expect(typeof billing.reinstate).toBe('function');
  });
});
