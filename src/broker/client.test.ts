import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createBroker } from './client';
import type { SnapTradeOperations } from './types';

const TEST_KEY = randomBytes(32).toString('base64');

function mockClient(): any {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: null, error: null })),
        })),
      })),
      upsert: vi.fn(() => ({ error: null })),
    })),
  };
}

function mockSnaptrade(): SnapTradeOperations {
  return {
    apiStatus: { check: vi.fn().mockResolvedValue({ data: { online: true } }) },
    authentication: {
      registerSnapTradeUser: vi.fn().mockResolvedValue({ data: { userSecret: 'secret' } }),
      loginSnapTradeUser: vi.fn().mockResolvedValue({ data: { redirectURI: 'https://url' } }),
    },
    accountInformation: {
      listUserAccounts: vi.fn().mockResolvedValue({ data: [] }),
      getUserHoldings: vi.fn().mockResolvedValue({ data: {} }),
      getAccountActivities: vi.fn().mockResolvedValue({ data: [] }),
      getUserAccountRecentOrders: vi.fn().mockResolvedValue({ data: [] }),
      getUserAccountOrderDetail: vi.fn().mockResolvedValue({ data: {} }),
    },
    connections: {
      listBrokerageAuthorizations: vi.fn().mockResolvedValue({ data: [] }),
      removeBrokerageAuthorization: vi.fn().mockResolvedValue({}),
    },
    referenceData: {
      getSymbols: vi.fn().mockResolvedValue({ data: [] }),
      symbolSearchUserAccount: vi.fn().mockResolvedValue({ data: [] }),
      listAllBrokerageInstruments: vi.fn().mockResolvedValue({ data: { instruments: [] } }),
    },
    trading: {
      getUserAccountQuotes: vi.fn().mockResolvedValue({ data: [] }),
      getOrderImpact: vi.fn().mockResolvedValue({ data: {} }),
      placeForceOrder: vi.fn().mockResolvedValue({ data: { brokerage_order_id: 'o1' } }),
    },
  };
}

describe('createBroker', () => {
  it('returns a module with all expected methods', () => {
    const mod = createBroker(mockClient(), {
      snaptrade: mockSnaptrade(),
      userId: 'user-1',
      encryptionKey: TEST_KEY,
    });

    expect(typeof mod.getStatus).toBe('function');
    expect(typeof mod.listConnections).toBe('function');
    expect(typeof mod.getConnectionUrl).toBe('function');
    expect(typeof mod.removeConnection).toBe('function');
    expect(typeof mod.ensureUserRegistered).toBe('function');
    expect(typeof mod.getHoldings).toBe('function');
    expect(typeof mod.listActivities).toBe('function');
    expect(typeof mod.listRecentOrders).toBe('function');
    expect(typeof mod.getOrderDetail).toBe('function');
    expect(typeof mod.getQuotes).toBe('function');
    expect(typeof mod.searchSymbols).toBe('function');
    expect(typeof mod.previewTradeImpact).toBe('function');
    expect(typeof mod.placeOrder).toBe('function');
    expect(typeof mod.listInstruments).toBe('function');
  });

  it('delegates getStatus to snaptrade.apiStatus.check', async () => {
    const snap = mockSnaptrade();
    const mod = createBroker(mockClient(), {
      snaptrade: snap,
      userId: 'user-1',
      encryptionKey: TEST_KEY,
    });

    const result = await mod.getStatus();
    expect(result).toEqual({ online: true });
    expect(snap.apiStatus.check).toHaveBeenCalledTimes(1);
  });

  it('delegates listInstruments to referenceData', async () => {
    const snap = mockSnaptrade();
    const mod = createBroker(mockClient(), {
      snaptrade: snap,
      userId: 'user-1',
      encryptionKey: TEST_KEY,
    });

    const result = await mod.listInstruments('robinhood');
    expect(result).toEqual([]);
    expect(snap.referenceData.listAllBrokerageInstruments).toHaveBeenCalledWith({
      slug: 'robinhood',
    });
  });

  it('throws when snaptrade is not configured', () => {
    const mod = createBroker(mockClient());
    expect(() => mod.getStatus()).toThrow(
      'BrokerModule requires a SnapTrade client',
    );
  });

  it('throws when userId is not configured', () => {
    const mod = createBroker(mockClient(), {
      snaptrade: mockSnaptrade(),
    });
    expect(() => mod.listConnections()).toThrow(
      'BrokerModule requires a userId',
    );
  });

  it('throws when encryptionKey is not configured', () => {
    const mod = createBroker(mockClient(), {
      snaptrade: mockSnaptrade(),
      userId: 'user-1',
    });
    expect(() => mod.listConnections()).toThrow(
      'BrokerModule requires an encryptionKey',
    );
  });

  it('works without config (all methods throw on call)', () => {
    const mod = createBroker(mockClient());
    expect(() => mod.getStatus()).toThrow();
    expect(() => mod.listConnections()).toThrow();
    expect(() => mod.ensureUserRegistered()).toThrow();
    expect(() => mod.getHoldings('acc-1')).toThrow();
    expect(() => mod.searchSymbols('AAPL')).toThrow();
  });
});
