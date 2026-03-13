import { describe, it, expect, vi } from 'vitest';
import { executeSingleOrder, executeTradeOrders } from './execute';
import type { BrokerOperations, StoredOrder } from './types';

function createMockBroker(overrides?: Partial<BrokerOperations>): BrokerOperations {
  return {
    getHoldings: vi.fn(),
    getQuotes: vi.fn(),
    listInstruments: vi.fn(),
    placeOrder: vi.fn().mockResolvedValue({ brokerageOrderId: 'brok-1', response: { ok: true } }),
    getOrderDetail: vi.fn().mockResolvedValue({ status: 'EXECUTED' }),
    ...overrides,
  };
}

function makeStoredOrder(overrides: Partial<StoredOrder>): StoredOrder {
  return {
    id: 1,
    batchId: 'batch-1',
    userId: 'user-1',
    strategyId: 1,
    accountId: 'acct-1',
    allocationName: 'Allocation A',
    action: 'BUY',
    symbol: 'SPY',
    quantity: 10,
    estimatedPrice: 100,
    estimatedValue: 1000,
    status: null,
    expiresAt: new Date('2030-01-01'),
    confirmedAt: null,
    rejectedAt: null,
    snaptradeOrderId: null,
    snaptradeResponse: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// executeSingleOrder
// ---------------------------------------------------------------------------

describe('executeSingleOrder', () => {
  it('returns brokerage order id and response on success', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockResolvedValue({
        brokerageOrderId: 'order-123',
        response: { filled: true },
      }),
    });

    const result = await executeSingleOrder(broker, 'acct-1', {
      action: 'BUY',
      symbol: 'SPY',
      quantity: 10,
    });

    expect(result.snaptradeOrderId).toBe('order-123');
    expect(result.snaptradeResponse).toEqual({ filled: true });
    expect(result.error).toBeUndefined();
    expect(broker.placeOrder).toHaveBeenCalledWith('acct-1', {
      action: 'BUY',
      symbol: 'SPY',
      quantity: 10,
    });
  });

  it('returns error message on failure', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockRejectedValue(new Error('Insufficient funds')),
    });

    const result = await executeSingleOrder(broker, 'acct-1', {
      action: 'BUY',
      symbol: 'SPY',
      quantity: 10,
    });

    expect(result.error).toBe('Insufficient funds');
    expect(result.snaptradeOrderId).toBeUndefined();
  });

  it('returns generic message for non-Error exceptions', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockRejectedValue('string error'),
    });

    const result = await executeSingleOrder(broker, 'acct-1', {
      action: 'SELL',
      symbol: 'QQQ',
      quantity: 5,
    });

    expect(result.error).toBe('Unknown error placing order');
  });
});

// ---------------------------------------------------------------------------
// executeTradeOrders
// ---------------------------------------------------------------------------

describe('executeTradeOrders', () => {
  it('executes sells before buys', async () => {
    const callOrder: string[] = [];
    const broker = createMockBroker({
      placeOrder: vi.fn().mockImplementation((_accountId, order) => {
        callOrder.push(order.action);
        return Promise.resolve({ brokerageOrderId: `brok-${order.symbol}`, response: {} });
      }),
      getOrderDetail: vi.fn().mockResolvedValue({ status: 'EXECUTED' }),
    });

    const orders = [
      makeStoredOrder({ id: 1, action: 'BUY', symbol: 'QQQ', quantity: 10 }),
      makeStoredOrder({ id: 2, action: 'SELL', symbol: 'SPY', quantity: 5 }),
      makeStoredOrder({ id: 3, action: 'BUY', symbol: 'TLT', quantity: 3 }),
    ];

    const results = await executeTradeOrders(broker, 'acct-1', orders, {
      waitForSellFills: true,
      sellFillTimeoutMs: 100,
      sellFillPollIntervalMs: 10,
    });

    expect(callOrder[0]).toBe('SELL');
    expect(callOrder[1]).toBe('BUY');
    expect(callOrder[2]).toBe('BUY');
    expect(results.size).toBe(3);
    expect(results.get(2)!.snaptradeOrderId).toBe('brok-SPY');
    expect(results.get(1)!.snaptradeOrderId).toBe('brok-QQQ');
    expect(results.get(3)!.snaptradeOrderId).toBe('brok-TLT');
  });

  it('skips buys when sell placement fails', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockRejectedValue(new Error('API error')),
    });

    const orders = [
      makeStoredOrder({ id: 1, action: 'SELL', symbol: 'SPY', quantity: 5 }),
      makeStoredOrder({ id: 2, action: 'BUY', symbol: 'QQQ', quantity: 10 }),
    ];

    const results = await executeTradeOrders(broker, 'acct-1', orders, {
      waitForSellFills: true,
    });

    expect(results.get(1)!.error).toBe('API error');
    expect(results.get(2)!.error).toContain('Skipped BUY');
    expect(results.get(2)!.error).toContain('SELL placement failed');
  });

  it('skips buys when sell has no brokerage order id', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockResolvedValue({ response: {} }), // No brokerageOrderId
    });

    const orders = [
      makeStoredOrder({ id: 1, action: 'SELL', symbol: 'SPY', quantity: 5 }),
      makeStoredOrder({ id: 2, action: 'BUY', symbol: 'QQQ', quantity: 10 }),
    ];

    const results = await executeTradeOrders(broker, 'acct-1', orders, {
      waitForSellFills: true,
    });

    expect(results.get(2)!.error).toContain('Skipped BUY');
    expect(results.get(2)!.error).toContain('Missing brokerage_order_id');
  });

  it('skips buys when sell fill polling times out', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockResolvedValue({ brokerageOrderId: 'brok-1', response: {} }),
      getOrderDetail: vi.fn().mockResolvedValue({ status: 'PENDING' }),
    });

    const orders = [
      makeStoredOrder({ id: 1, action: 'SELL', symbol: 'SPY', quantity: 5 }),
      makeStoredOrder({ id: 2, action: 'BUY', symbol: 'QQQ', quantity: 10 }),
    ];

    const results = await executeTradeOrders(broker, 'acct-1', orders, {
      waitForSellFills: true,
      sellFillTimeoutMs: 50,
      sellFillPollIntervalMs: 10,
    });

    expect(results.get(2)!.error).toContain('Skipped BUY');
    expect(results.get(2)!.error).toContain('not filled within');
  });

  it('skips buys when sell reaches terminal non-filled status', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockResolvedValue({ brokerageOrderId: 'brok-1', response: { placed: true } }),
      getOrderDetail: vi.fn().mockResolvedValue({ status: 'CANCELED' }),
    });

    const orders = [
      makeStoredOrder({ id: 1, action: 'SELL', symbol: 'SPY', quantity: 5 }),
      makeStoredOrder({ id: 2, action: 'BUY', symbol: 'QQQ', quantity: 10 }),
    ];

    const results = await executeTradeOrders(broker, 'acct-1', orders, {
      waitForSellFills: true,
      sellFillTimeoutMs: 100,
      sellFillPollIntervalMs: 10,
    });

    expect(results.get(2)!.error).toContain('Skipped BUY');
    expect(results.get(2)!.error).toContain('CANCELED');
  });

  it('skips buys when sell fill polling rejects', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockResolvedValue({ brokerageOrderId: 'brok-1', response: {} }),
      getOrderDetail: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    const orders = [
      makeStoredOrder({ id: 1, action: 'SELL', symbol: 'SPY', quantity: 5 }),
      makeStoredOrder({ id: 2, action: 'BUY', symbol: 'QQQ', quantity: 10 }),
    ];

    const results = await executeTradeOrders(broker, 'acct-1', orders, {
      waitForSellFills: true,
      sellFillTimeoutMs: 100,
      sellFillPollIntervalMs: 10,
    });

    expect(results.get(2)!.error).toContain('Skipped BUY');
    expect(results.get(2)!.error).toContain('error polling SELL fills');
  });

  it('proceeds without waiting when waitForSellFills is false', async () => {
    const callOrder: string[] = [];
    const broker = createMockBroker({
      placeOrder: vi.fn().mockImplementation((_accountId, order) => {
        callOrder.push(order.action);
        return Promise.resolve({ brokerageOrderId: `brok-${order.symbol}`, response: {} });
      }),
    });

    const orders = [
      makeStoredOrder({ id: 1, action: 'SELL', symbol: 'SPY', quantity: 5 }),
      makeStoredOrder({ id: 2, action: 'BUY', symbol: 'QQQ', quantity: 10 }),
    ];

    const results = await executeTradeOrders(broker, 'acct-1', orders, {
      waitForSellFills: false,
    });

    expect(callOrder).toEqual(['SELL', 'BUY']);
    expect(results.size).toBe(2);
    expect(broker.getOrderDetail).not.toHaveBeenCalled();
  });

  it('handles buy-only orders', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockResolvedValue({ brokerageOrderId: 'brok-1', response: {} }),
    });

    const orders = [makeStoredOrder({ id: 1, action: 'BUY', symbol: 'SPY', quantity: 10 })];

    const results = await executeTradeOrders(broker, 'acct-1', orders);

    expect(results.size).toBe(1);
    expect(results.get(1)!.snaptradeOrderId).toBe('brok-1');
  });

  it('handles sell-only orders', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockResolvedValue({ brokerageOrderId: 'brok-1', response: {} }),
      getOrderDetail: vi.fn().mockResolvedValue({ status: 'EXECUTED' }),
    });

    const orders = [makeStoredOrder({ id: 1, action: 'SELL', symbol: 'SPY', quantity: 5 })];

    const results = await executeTradeOrders(broker, 'acct-1', orders, {
      waitForSellFills: true,
      sellFillTimeoutMs: 100,
      sellFillPollIntervalMs: 10,
    });

    expect(results.size).toBe(1);
    expect(results.get(1)!.snaptradeOrderId).toBe('brok-1');
  });

  it('handles empty orders', async () => {
    const broker = createMockBroker();
    const results = await executeTradeOrders(broker, 'acct-1', []);

    expect(results.size).toBe(0);
    expect(broker.placeOrder).not.toHaveBeenCalled();
  });

  it('detects fill via quantity fields', async () => {
    const broker = createMockBroker({
      placeOrder: vi.fn().mockResolvedValue({ brokerageOrderId: 'brok-1', response: {} }),
      getOrderDetail: vi.fn().mockResolvedValue({
        status: 'PARTIAL',
        total_quantity: '10',
        open_quantity: '0',
        filled_quantity: '10',
      }),
    });

    const orders = [
      makeStoredOrder({ id: 1, action: 'SELL', symbol: 'SPY', quantity: 10 }),
      makeStoredOrder({ id: 2, action: 'BUY', symbol: 'QQQ', quantity: 5 }),
    ];

    const results = await executeTradeOrders(broker, 'acct-1', orders, {
      waitForSellFills: true,
      sellFillTimeoutMs: 100,
      sellFillPollIntervalMs: 10,
    });

    // Should proceed to buys since quantities indicate fill
    expect(results.get(2)!.error).toBeUndefined();
    expect(results.get(2)!.snaptradeOrderId).toBe('brok-1');
  });
});
