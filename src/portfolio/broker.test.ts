import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';
import { encryptUserSecret } from './secret';

// ---------------------------------------------------------------------------
// Mock SnapTrade SDK — must be before any imports that use it
// ---------------------------------------------------------------------------

const mockListUserAccounts = vi.fn();
const mockListBrokerageAuthorizations = vi.fn();
const mockGetUserHoldings = vi.fn();
const mockGetAccountActivities = vi.fn();
const mockGetUserAccountRecentOrders = vi.fn();
const mockGetSymbols = vi.fn();
const mockGetUserAccountQuotes = vi.fn();
const mockGetOrderImpact = vi.fn();
const mockPlaceForceOrder = vi.fn();
const mockLoginSnapTradeUser = vi.fn();
const mockRemoveBrokerageAuthorization = vi.fn();
const mockRegisterSnapTradeUser = vi.fn();

vi.mock('snaptrade-typescript-sdk', () => ({
  Snaptrade: class MockSnaptrade {
    accountInformation = {
      listUserAccounts: mockListUserAccounts,
      getUserHoldings: mockGetUserHoldings,
      getAccountActivities: mockGetAccountActivities,
      getUserAccountRecentOrders: mockGetUserAccountRecentOrders,
    };
    connections = {
      listBrokerageAuthorizations: mockListBrokerageAuthorizations,
      removeBrokerageAuthorization: mockRemoveBrokerageAuthorization,
    };
    referenceData = {
      getSymbols: mockGetSymbols,
    };
    trading = {
      getUserAccountQuotes: mockGetUserAccountQuotes,
      getOrderImpact: mockGetOrderImpact,
      placeForceOrder: mockPlaceForceOrder,
    };
    authentication = {
      loginSnapTradeUser: mockLoginSnapTradeUser,
      registerSnapTradeUser: mockRegisterSnapTradeUser,
    };
  },
}));

import { createPortfolio } from './client';
import type { LivefolioClientConfig } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_ENCRYPTION_KEY = randomBytes(32).toString('base64');

const SNAPTRADE_CONFIG = {
  clientId: 'test-client',
  consumerKey: 'test-key',
  secretEncryptionKey: TEST_ENCRYPTION_KEY,
};

const CONFIG: LivefolioClientConfig = { snaptrade: SNAPTRADE_CONFIG };

function createMockSupabase(userSecretPlaintext = 'user-secret-123') {
  const ciphertext = encryptUserSecret(userSecretPlaintext, TEST_ENCRYPTION_KEY);
  const mockFrom = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { user_secret_ciphertext: ciphertext },
            error: null,
          }),
        }),
      }),
    }),
  }));

  return { from: mockFrom } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('portfolio broker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConnections', () => {
    it('aggregates accounts under connections', async () => {
      const supabase = createMockSupabase();
      const portfolio = createPortfolio(supabase, CONFIG);

      mockListUserAccounts.mockResolvedValue({
        data: [
          {
            id: 'acct-1',
            name: 'Main',
            number: '1234',
            institution_name: 'Broker Co',
            balance: { total: { amount: 1000, currency: 'USD' } },
            is_paper: false,
            brokerage_authorization: 'auth-1',
          },
        ],
      });
      mockListBrokerageAuthorizations.mockResolvedValue({
        data: [
          {
            id: 'auth-1',
            brokerage: { name: 'Broker Co', aws_s3_square_logo_url: 'https://logo.png' },
            disabled: false,
            type: 'read',
          },
        ],
      });

      const connections = await portfolio.getConnections('user-1');

      expect(connections).toHaveLength(1);
      expect(connections[0].authorizationId).toBe('auth-1');
      expect(connections[0].brokerageName).toBe('Broker Co');
      expect(connections[0].accounts).toHaveLength(1);
      expect(connections[0].accounts[0].id).toBe('acct-1');
      expect(connections[0].accounts[0].balance).toEqual({ amount: 1000, currency: 'USD' });
    });
  });

  describe('getHoldings', () => {
    it('returns normalized portfolio', async () => {
      const supabase = createMockSupabase();
      const portfolio = createPortfolio(supabase, CONFIG);

      mockGetUserHoldings.mockResolvedValue({
        data: {
          balances: [{ currency: { code: 'USD' }, cash: 500, buying_power: 500 }],
          positions: [
            {
              symbol: { symbol: { symbol: 'SPY' } },
              units: 10,
              price: 100,
            },
          ],
        },
      });

      const holdings = await portfolio.getHoldings('user-1', 'acct-1');

      expect(holdings.balancesByCurrency).toHaveLength(1);
      expect(holdings.balancesByCurrency[0]).toEqual({ currency: 'USD', cash: 500, buyingPower: 500 });
      expect(holdings.positions).toHaveLength(1);
      expect(holdings.positions[0]).toEqual({ symbol: 'SPY', units: 10, price: 100, marketValue: 1000 });
    });
  });

  describe('placeOrder', () => {
    it('returns order result on success', async () => {
      const supabase = createMockSupabase();
      const portfolio = createPortfolio(supabase, CONFIG);

      mockPlaceForceOrder.mockResolvedValue({
        data: { brokerage_order_id: 'order-123' },
      });

      const result = await portfolio.placeOrder('user-1', 'acct-1', {
        action: 'BUY',
        symbol: 'SPY',
        units: 5,
      });

      expect(result.snaptradeOrderId).toBe('order-123');
      expect(result.error).toBeUndefined();
    });

    it('returns error on failure', async () => {
      const supabase = createMockSupabase();
      const portfolio = createPortfolio(supabase, CONFIG);

      mockPlaceForceOrder.mockRejectedValue(new Error('Insufficient funds'));

      const result = await portfolio.placeOrder('user-1', 'acct-1', {
        action: 'BUY',
        symbol: 'SPY',
        units: 5,
      });

      expect(result.error).toBe('Insufficient funds');
      expect(result.snaptradeOrderId).toBeUndefined();
    });
  });

  describe('getConnectionUrl', () => {
    it('returns URL on success', async () => {
      const supabase = createMockSupabase();
      const portfolio = createPortfolio(supabase, CONFIG);

      mockLoginSnapTradeUser.mockResolvedValue({
        data: { redirectURI: 'https://snaptrade.com/connect/abc' },
      });

      const url = await portfolio.getConnectionUrl('user-1', {
        customRedirect: 'http://localhost:3000/callback',
      });

      expect(url).toBe('https://snaptrade.com/connect/abc');
    });

    it('returns null when no redirectURI', async () => {
      const supabase = createMockSupabase();
      const portfolio = createPortfolio(supabase, CONFIG);

      mockLoginSnapTradeUser.mockResolvedValue({ data: {} });

      const url = await portfolio.getConnectionUrl('user-1', {
        customRedirect: 'http://localhost:3000/callback',
      });

      expect(url).toBeNull();
    });
  });

  describe('throws when SnapTrade config not provided', () => {
    it('getConnections throws without config', async () => {
      const supabase = createMockSupabase();
      const portfolio = createPortfolio(supabase);

      await expect(portfolio.getConnections('user-1')).rejects.toThrow(
        'SnapTrade config is required for broker operations',
      );
    });

    it('placeOrder throws without config', async () => {
      const supabase = createMockSupabase();
      const portfolio = createPortfolio(supabase);

      await expect(
        portfolio.placeOrder('user-1', 'acct-1', { action: 'BUY', symbol: 'SPY', units: 1 }),
      ).rejects.toThrow('SnapTrade config is required for broker operations');
    });
  });
});
