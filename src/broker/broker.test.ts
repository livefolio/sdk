import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { SnapTradeOperations } from './types';
import {
  getUserSecret,
  upsertUserSecret,
  requireUserSecret,
  getStatus,
  ensureUserRegistered,
  listConnections,
  getConnectionUrl,
  removeConnection,
  getHoldings,
  listActivities,
  listRecentOrders,
  getOrderDetail,
  getQuotes,
  searchSymbols,
  previewTradeImpact,
  placeOrder,
  listInstruments,
} from './broker';

const TEST_KEY = randomBytes(32).toString('base64');
const USER_ID = 'user-123';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockClient(overrides: Record<string, unknown> = {}): any {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: null, error: null })),
        })),
      })),
      upsert: vi.fn(() => ({ error: null })),
    })),
    ...overrides,
  };
}

/** Returns a client whose `from('brokerage_connections')` returns a stored secret. */
function mockClientWithSecret(ciphertext: string): any {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({
            data: { user_secret_ciphertext: ciphertext },
            error: null,
          })),
        })),
      })),
      upsert: vi.fn(() => ({ error: null })),
    })),
  };
}

function mockSnaptrade(overrides: Partial<SnapTradeOperations> = {}): SnapTradeOperations {
  return {
    apiStatus: { check: vi.fn().mockResolvedValue({ data: { online: true } }) },
    authentication: {
      registerSnapTradeUser: vi.fn().mockResolvedValue({ data: { userSecret: 'snap-secret' } }),
      loginSnapTradeUser: vi.fn().mockResolvedValue({ data: { redirectURI: 'https://portal.example.com' } }),
    },
    accountInformation: {
      listUserAccounts: vi.fn().mockResolvedValue({ data: [] }),
      getUserHoldings: vi.fn().mockResolvedValue({ data: { holdings: [] } }),
      getAccountActivities: vi.fn().mockResolvedValue({ data: [] }),
      getUserAccountRecentOrders: vi.fn().mockResolvedValue({ data: [] }),
      getUserAccountOrderDetail: vi.fn().mockResolvedValue({ data: { orderId: 'o1' } }),
    },
    connections: {
      listBrokerageAuthorizations: vi.fn().mockResolvedValue({ data: [] }),
      removeBrokerageAuthorization: vi.fn().mockResolvedValue({}),
    },
    referenceData: {
      getSymbols: vi.fn().mockResolvedValue({ data: [{ symbol: 'AAPL' }] }),
      symbolSearchUserAccount: vi.fn().mockResolvedValue({ data: [{ symbol: 'AAPL' }] }),
      listAllBrokerageInstruments: vi.fn().mockResolvedValue({ data: { instruments: [{ id: 'i1' }] } }),
    },
    trading: {
      getUserAccountQuotes: vi.fn().mockResolvedValue({ data: [{ symbol: 'AAPL', price: 150 }] }),
      getOrderImpact: vi.fn().mockResolvedValue({ data: { impact: true } }),
      placeForceOrder: vi.fn().mockResolvedValue({ data: { brokerage_order_id: 'order-1' } }),
    },
    ...overrides,
  };
}

/**
 * Encrypt a secret using the same module so our mock client can return it.
 */
async function encryptForTest(plaintext: string): Promise<string> {
  const { encryptSecret } = await import('./secret');
  return encryptSecret(plaintext, TEST_KEY);
}

// ---------------------------------------------------------------------------
// getUserSecret
// ---------------------------------------------------------------------------

describe('getUserSecret', () => {
  it('returns null when no row exists', async () => {
    const client = mockClient();
    const result = await getUserSecret(client, USER_ID, TEST_KEY);
    expect(result).toBeNull();
  });

  it('returns null when query errors', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({ data: null, error: { message: 'not found' } })),
          })),
        })),
      })),
    } as any;
    const result = await getUserSecret(client, USER_ID, TEST_KEY);
    expect(result).toBeNull();
  });

  it('decrypts and returns the secret when row exists', async () => {
    const ciphertext = await encryptForTest('my-user-secret');
    const client = mockClientWithSecret(ciphertext);
    const result = await getUserSecret(client, USER_ID, TEST_KEY);
    expect(result).toBe('my-user-secret');
  });
});

// ---------------------------------------------------------------------------
// upsertUserSecret
// ---------------------------------------------------------------------------

describe('upsertUserSecret', () => {
  it('upserts encrypted secret without error', async () => {
    const upsertMock = vi.fn(() => ({ error: null }));
    const client = {
      from: vi.fn(() => ({ upsert: upsertMock })),
    } as any;

    await expect(
      upsertUserSecret(client, USER_ID, 'some-secret', TEST_KEY),
    ).resolves.toBeUndefined();

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0];
    expect(call[0].user_id).toBe(USER_ID);
    // ciphertext should be a v1: prefixed string
    expect(call[0].user_secret_ciphertext).toMatch(/^v1:/);
    expect(call[1]).toEqual({ onConflict: 'user_id' });
  });

  it('throws when upsert fails', async () => {
    const client = {
      from: vi.fn(() => ({
        upsert: vi.fn(() => ({ error: { message: 'db error' } })),
      })),
    } as any;

    await expect(
      upsertUserSecret(client, USER_ID, 'secret', TEST_KEY),
    ).rejects.toThrow('Failed to upsert brokerage connection secret');
  });
});

// ---------------------------------------------------------------------------
// requireUserSecret
// ---------------------------------------------------------------------------

describe('requireUserSecret', () => {
  it('returns secret when it exists', async () => {
    const ciphertext = await encryptForTest('req-secret');
    const client = mockClientWithSecret(ciphertext);
    const result = await requireUserSecret(client, USER_ID, TEST_KEY);
    expect(result).toBe('req-secret');
  });

  it('throws when no secret exists', async () => {
    const client = mockClient();
    await expect(requireUserSecret(client, USER_ID, TEST_KEY)).rejects.toThrow(
      'No brokerage connection secret found for user',
    );
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe('getStatus', () => {
  it('returns API status data', async () => {
    const snap = mockSnaptrade();
    const result = await getStatus(snap);
    expect(result).toEqual({ online: true });
    expect(snap.apiStatus.check).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// ensureUserRegistered
// ---------------------------------------------------------------------------

describe('ensureUserRegistered', () => {
  it('returns existing secret without registering', async () => {
    const ciphertext = await encryptForTest('existing-secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    const result = await ensureUserRegistered(client, snap, USER_ID, TEST_KEY);
    expect(result).toBe('existing-secret');
    expect(snap.authentication.registerSnapTradeUser).not.toHaveBeenCalled();
  });

  it('registers and stores a new secret', async () => {
    const upsertMock = vi.fn(() => ({ error: null }));
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'brokerage_connections') {
          // First call: getUserSecret (returns null)
          // Subsequent call: upsert
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(() => ({ data: null, error: null })),
              })),
            })),
            upsert: upsertMock,
          };
        }
        return {};
      }),
    } as any;
    const snap = mockSnaptrade();

    const result = await ensureUserRegistered(client, snap, USER_ID, TEST_KEY);
    expect(result).toBe('snap-secret');
    expect(snap.authentication.registerSnapTradeUser).toHaveBeenCalledWith({
      userId: USER_ID,
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when registration fails', async () => {
    const client = mockClient();
    const snap = mockSnaptrade({
      authentication: {
        registerSnapTradeUser: vi.fn().mockRejectedValue(new Error('API error')),
        loginSnapTradeUser: vi.fn(),
      },
    });

    const result = await ensureUserRegistered(client, snap, USER_ID, TEST_KEY);
    expect(result).toBeNull();
  });

  it('returns null when registration returns no secret', async () => {
    const client = mockClient();
    const snap = mockSnaptrade({
      authentication: {
        registerSnapTradeUser: vi.fn().mockResolvedValue({ data: { userSecret: null } }),
        loginSnapTradeUser: vi.fn(),
      },
    });

    const result = await ensureUserRegistered(client, snap, USER_ID, TEST_KEY);
    expect(result).toBeNull();
  });

  it('returns null when upsert fails', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(() => ({ data: null, error: null })),
          })),
        })),
        upsert: vi.fn(() => ({ error: { message: 'db down' } })),
      })),
    } as any;
    const snap = mockSnaptrade();

    const result = await ensureUserRegistered(client, snap, USER_ID, TEST_KEY);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listConnections
// ---------------------------------------------------------------------------

describe('listConnections', () => {
  it('returns normalized connections with accounts', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade({
      accountInformation: {
        listUserAccounts: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'acc-1',
              name: 'My Account',
              number: '123',
              institution_name: 'Robinhood',
              balance: { total: { amount: 10000, currency: 'USD' } },
              is_paper: false,
              brokerage_authorization: 'auth-1',
            },
          ],
        }),
        getUserHoldings: vi.fn(),
        getAccountActivities: vi.fn(),
        getUserAccountRecentOrders: vi.fn(),
        getUserAccountOrderDetail: vi.fn(),
      },
      connections: {
        listBrokerageAuthorizations: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'auth-1',
              brokerage: { name: 'Robinhood', aws_s3_square_logo_url: 'https://logo.png' },
              disabled: false,
              type: 'read',
            },
          ],
        }),
        removeBrokerageAuthorization: vi.fn(),
      },
    });

    const result = await listConnections(client, snap, USER_ID, TEST_KEY);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      authorizationId: 'auth-1',
      brokerageName: 'Robinhood',
      logoUrl: 'https://logo.png',
      disabled: false,
      type: 'read',
      accounts: [
        {
          id: 'acc-1',
          name: 'My Account',
          number: '123',
          institutionName: 'Robinhood',
          balance: { amount: 10000, currency: 'USD' },
          isPaper: false,
        },
      ],
    });
  });

  it('returns empty accounts for auths with no matched accounts', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade({
      accountInformation: {
        listUserAccounts: vi.fn().mockResolvedValue({ data: [] }),
        getUserHoldings: vi.fn(),
        getAccountActivities: vi.fn(),
        getUserAccountRecentOrders: vi.fn(),
        getUserAccountOrderDetail: vi.fn(),
      },
      connections: {
        listBrokerageAuthorizations: vi.fn().mockResolvedValue({
          data: [{ id: 'auth-1', name: 'Fallback Name', disabled: false, type: null }],
        }),
        removeBrokerageAuthorization: vi.fn(),
      },
    });

    const result = await listConnections(client, snap, USER_ID, TEST_KEY);
    expect(result).toHaveLength(1);
    expect(result[0].brokerageName).toBe('Fallback Name');
    expect(result[0].logoUrl).toBeNull();
    expect(result[0].accounts).toEqual([]);
  });

  it('falls back to "Unknown" when no brokerage name', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade({
      accountInformation: {
        listUserAccounts: vi.fn().mockResolvedValue({ data: [] }),
        getUserHoldings: vi.fn(),
        getAccountActivities: vi.fn(),
        getUserAccountRecentOrders: vi.fn(),
        getUserAccountOrderDetail: vi.fn(),
      },
      connections: {
        listBrokerageAuthorizations: vi.fn().mockResolvedValue({
          data: [{ id: 'auth-1' }],
        }),
        removeBrokerageAuthorization: vi.fn(),
      },
    });

    const result = await listConnections(client, snap, USER_ID, TEST_KEY);
    expect(result[0].brokerageName).toBe('Unknown');
  });

  it('handles account with no balance', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade({
      accountInformation: {
        listUserAccounts: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'acc-1',
              name: null,
              number: '456',
              institution_name: 'Broker',
              balance: null,
              is_paper: true,
              brokerage_authorization: 'auth-1',
            },
          ],
        }),
        getUserHoldings: vi.fn(),
        getAccountActivities: vi.fn(),
        getUserAccountRecentOrders: vi.fn(),
        getUserAccountOrderDetail: vi.fn(),
      },
      connections: {
        listBrokerageAuthorizations: vi.fn().mockResolvedValue({
          data: [{ id: 'auth-1', brokerage: { name: 'Broker' } }],
        }),
        removeBrokerageAuthorization: vi.fn(),
      },
    });

    const result = await listConnections(client, snap, USER_ID, TEST_KEY);
    expect(result[0].accounts[0].balance).toBeNull();
    expect(result[0].accounts[0].name).toBeNull();
    expect(result[0].accounts[0].isPaper).toBe(true);
  });

  it('throws when no secret exists', async () => {
    const client = mockClient();
    const snap = mockSnaptrade();
    await expect(
      listConnections(client, snap, USER_ID, TEST_KEY),
    ).rejects.toThrow('No brokerage connection secret found for user');
  });
});

// ---------------------------------------------------------------------------
// getConnectionUrl
// ---------------------------------------------------------------------------

describe('getConnectionUrl', () => {
  it('returns the redirect URI', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    const result = await getConnectionUrl(client, snap, USER_ID, TEST_KEY, {
      customRedirect: 'https://app.com/callback',
    });
    expect(result).toBe('https://portal.example.com');
    expect(snap.authentication.loginSnapTradeUser).toHaveBeenCalledWith({
      userId: USER_ID,
      userSecret: 'secret',
      customRedirect: 'https://app.com/callback',
      connectionType: 'trade-if-available',
    });
  });

  it('passes custom connectionType', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    await getConnectionUrl(client, snap, USER_ID, TEST_KEY, {
      customRedirect: 'https://app.com',
      connectionType: 'read',
    });
    expect(snap.authentication.loginSnapTradeUser).toHaveBeenCalledWith(
      expect.objectContaining({ connectionType: 'read' }),
    );
  });

  it('returns null when no redirectURI in response', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade({
      authentication: {
        registerSnapTradeUser: vi.fn(),
        loginSnapTradeUser: vi.fn().mockResolvedValue({ data: { someOtherField: true } }),
      },
    });

    const result = await getConnectionUrl(client, snap, USER_ID, TEST_KEY, {
      customRedirect: 'https://app.com',
    });
    expect(result).toBeNull();
  });

  it('returns null when redirectURI is null', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade({
      authentication: {
        registerSnapTradeUser: vi.fn(),
        loginSnapTradeUser: vi.fn().mockResolvedValue({ data: { redirectURI: null } }),
      },
    });

    const result = await getConnectionUrl(client, snap, USER_ID, TEST_KEY, {
      customRedirect: 'https://app.com',
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// removeConnection
// ---------------------------------------------------------------------------

describe('removeConnection', () => {
  it('calls removeBrokerageAuthorization with correct params', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    await removeConnection(client, snap, USER_ID, TEST_KEY, 'auth-42');
    expect(snap.connections.removeBrokerageAuthorization).toHaveBeenCalledWith({
      authorizationId: 'auth-42',
      userId: USER_ID,
      userSecret: 'secret',
    });
  });

  it('throws when no secret exists', async () => {
    const client = mockClient();
    const snap = mockSnaptrade();
    await expect(
      removeConnection(client, snap, USER_ID, TEST_KEY, 'auth-1'),
    ).rejects.toThrow('No brokerage connection secret found for user');
  });
});

// ---------------------------------------------------------------------------
// getHoldings
// ---------------------------------------------------------------------------

describe('getHoldings', () => {
  it('returns holdings data', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    const result = await getHoldings(client, snap, USER_ID, TEST_KEY, 'acc-1');
    expect(result).toEqual({ holdings: [] });
    expect(snap.accountInformation.getUserHoldings).toHaveBeenCalledWith({
      accountId: 'acc-1',
      userId: USER_ID,
      userSecret: 'secret',
    });
  });

  it('throws when no secret', async () => {
    const client = mockClient();
    const snap = mockSnaptrade();
    await expect(
      getHoldings(client, snap, USER_ID, TEST_KEY, 'acc-1'),
    ).rejects.toThrow('No brokerage connection secret found for user');
  });
});

// ---------------------------------------------------------------------------
// listActivities
// ---------------------------------------------------------------------------

describe('listActivities', () => {
  it('returns activities with options', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    const result = await listActivities(client, snap, USER_ID, TEST_KEY, 'acc-1', {
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      type: 'DIVIDEND',
    });
    expect(result).toEqual([]);
    expect(snap.accountInformation.getAccountActivities).toHaveBeenCalledWith({
      accountId: 'acc-1',
      userId: USER_ID,
      userSecret: 'secret',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      offset: undefined,
      limit: undefined,
      type: 'DIVIDEND',
    });
  });

  it('works with default options', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    await listActivities(client, snap, USER_ID, TEST_KEY, 'acc-1');
    expect(snap.accountInformation.getAccountActivities).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1' }),
    );
  });
});

// ---------------------------------------------------------------------------
// listRecentOrders
// ---------------------------------------------------------------------------

describe('listRecentOrders', () => {
  it('returns recent orders', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    const result = await listRecentOrders(client, snap, USER_ID, TEST_KEY, 'acc-1', {
      onlyExecuted: true,
    });
    expect(result).toEqual([]);
    expect(snap.accountInformation.getUserAccountRecentOrders).toHaveBeenCalledWith({
      accountId: 'acc-1',
      userId: USER_ID,
      userSecret: 'secret',
      onlyExecuted: true,
    });
  });

  it('works with default options', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    await listRecentOrders(client, snap, USER_ID, TEST_KEY, 'acc-1');
    expect(snap.accountInformation.getUserAccountRecentOrders).toHaveBeenCalledWith(
      expect.objectContaining({ onlyExecuted: undefined }),
    );
  });
});

// ---------------------------------------------------------------------------
// getOrderDetail
// ---------------------------------------------------------------------------

describe('getOrderDetail', () => {
  it('returns order detail', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    const result = await getOrderDetail(
      client,
      snap,
      USER_ID,
      TEST_KEY,
      'acc-1',
      'order-42',
    );
    expect(result).toEqual({ orderId: 'o1' });
    expect(snap.accountInformation.getUserAccountOrderDetail).toHaveBeenCalledWith({
      accountId: 'acc-1',
      userId: USER_ID,
      userSecret: 'secret',
      brokerage_order_id: 'order-42',
    });
  });
});

// ---------------------------------------------------------------------------
// getQuotes
// ---------------------------------------------------------------------------

describe('getQuotes', () => {
  it('returns quotes with joined symbols', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    const result = await getQuotes(client, snap, USER_ID, TEST_KEY, 'acc-1', [
      'AAPL',
      'GOOG',
    ]);
    expect(result).toEqual([{ symbol: 'AAPL', price: 150 }]);
    expect(snap.trading.getUserAccountQuotes).toHaveBeenCalledWith({
      userId: USER_ID,
      userSecret: 'secret',
      accountId: 'acc-1',
      symbols: 'AAPL,GOOG',
      useTicker: true,
    });
  });
});

// ---------------------------------------------------------------------------
// searchSymbols
// ---------------------------------------------------------------------------

describe('searchSymbols', () => {
  it('searches globally without accountId', async () => {
    const client = mockClient();
    const snap = mockSnaptrade();

    const result = await searchSymbols(client, snap, USER_ID, TEST_KEY, 'AAPL');
    expect(result).toEqual([{ symbol: 'AAPL' }]);
    expect(snap.referenceData.getSymbols).toHaveBeenCalledWith({
      substring: 'AAPL',
    });
    expect(snap.referenceData.symbolSearchUserAccount).not.toHaveBeenCalled();
  });

  it('searches within account when accountId provided', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    const result = await searchSymbols(
      client,
      snap,
      USER_ID,
      TEST_KEY,
      'AAPL',
      'acc-1',
    );
    expect(result).toEqual([{ symbol: 'AAPL' }]);
    expect(snap.referenceData.symbolSearchUserAccount).toHaveBeenCalledWith({
      userId: USER_ID,
      userSecret: 'secret',
      accountId: 'acc-1',
      substring: 'AAPL',
    });
    expect(snap.referenceData.getSymbols).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// previewTradeImpact
// ---------------------------------------------------------------------------

describe('previewTradeImpact', () => {
  it('returns trade impact preview', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    const result = await previewTradeImpact(
      client,
      snap,
      USER_ID,
      TEST_KEY,
      'acc-1',
      {
        action: 'BUY',
        universalSymbolId: 'sym-1',
        orderType: 'Market',
        timeInForce: 'Day',
        units: 10,
      },
    );
    expect(result).toEqual({ impact: true });
    expect(snap.trading.getOrderImpact).toHaveBeenCalledWith({
      userId: USER_ID,
      userSecret: 'secret',
      account_id: 'acc-1',
      action: 'BUY',
      universal_symbol_id: 'sym-1',
      order_type: 'Market',
      time_in_force: 'Day',
      price: null,
      stop: null,
      units: 10,
      notional_value: null,
    });
  });

  it('passes optional price and stop', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    await previewTradeImpact(client, snap, USER_ID, TEST_KEY, 'acc-1', {
      action: 'SELL',
      universalSymbolId: 'sym-2',
      orderType: 'Limit',
      timeInForce: 'GTC',
      price: 100.5,
      stop: 95,
      units: 5,
      notionalValue: 500,
    });
    expect(snap.trading.getOrderImpact).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 100.5,
        stop: 95,
        units: 5,
        notional_value: 500,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// placeOrder
// ---------------------------------------------------------------------------

describe('placeOrder', () => {
  it('returns order result with brokerage order id', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade();

    const result = await placeOrder(client, snap, USER_ID, TEST_KEY, 'acc-1', {
      action: 'BUY',
      universalSymbolId: 'sym-1',
      orderType: 'Market',
      timeInForce: 'Day',
      units: 10,
    });
    expect(result).toEqual({
      brokerageOrderId: 'order-1',
      raw: { brokerage_order_id: 'order-1' },
    });
    expect(snap.trading.placeForceOrder).toHaveBeenCalledWith({
      userId: USER_ID,
      userSecret: 'secret',
      account_id: 'acc-1',
      action: 'BUY',
      universal_symbol_id: 'sym-1',
      order_type: 'Market',
      time_in_force: 'Day',
      price: null,
      stop: null,
      units: 10,
      notional_value: null,
    });
  });

  it('returns null brokerage order id when not present', async () => {
    const ciphertext = await encryptForTest('secret');
    const client = mockClientWithSecret(ciphertext);
    const snap = mockSnaptrade({
      trading: {
        getUserAccountQuotes: vi.fn(),
        getOrderImpact: vi.fn(),
        placeForceOrder: vi.fn().mockResolvedValue({ data: {} }),
      },
    });

    const result = await placeOrder(client, snap, USER_ID, TEST_KEY, 'acc-1', {
      action: 'SELL',
      universalSymbolId: 'sym-1',
      orderType: 'Limit',
      timeInForce: 'GTC',
      price: 150,
    });
    expect(result.brokerageOrderId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listInstruments
// ---------------------------------------------------------------------------

describe('listInstruments', () => {
  it('returns instruments array', async () => {
    const snap = mockSnaptrade();
    const result = await listInstruments(snap, 'robinhood');
    expect(result).toEqual([{ id: 'i1' }]);
    expect(snap.referenceData.listAllBrokerageInstruments).toHaveBeenCalledWith({
      slug: 'robinhood',
    });
  });

  it('returns empty array when no instruments', async () => {
    const snap = mockSnaptrade({
      referenceData: {
        getSymbols: vi.fn(),
        symbolSearchUserAccount: vi.fn(),
        listAllBrokerageInstruments: vi
          .fn()
          .mockResolvedValue({ data: {} }),
      },
    });

    const result = await listInstruments(snap, 'unknown');
    expect(result).toEqual([]);
  });
});
