import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateSubscriptions } from './cron';
import type { SubscriptionForEvaluation } from './types';
import type { MarketModule } from '../market/types';
import type { Strategy } from './types';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockClient() {
  const mockRpc = vi.fn();
  const mockFrom = vi.fn();
  const client = {
    from: mockFrom,
    rpc: mockRpc,
  } as any;
  return { client, mockFrom, mockRpc };
}

function createMockMarket(seriesData: Record<string, { timestamp: string; value: number }[]>): MarketModule {
  return {
    getBatchSeries: vi.fn().mockResolvedValue(seriesData),
  } as any;
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

function marketCloseUTC(dateStr: string): string {
  return `${dateStr}T21:00:00.000Z`;
}

const SERIES_DATA: Record<string, { timestamp: string; value: number }[]> = {
  SPY: [
    { timestamp: marketCloseUTC('2025-01-06'), value: 100 },
    { timestamp: marketCloseUTC('2025-01-07'), value: 102 },
    { timestamp: marketCloseUTC('2025-01-08'), value: 101 },
    { timestamp: marketCloseUTC('2025-01-09'), value: 103 },
    { timestamp: marketCloseUTC('2025-01-10'), value: 104 },
  ],
  BND: [
    { timestamp: marketCloseUTC('2025-01-06'), value: 80 },
    { timestamp: marketCloseUTC('2025-01-07'), value: 80 },
    { timestamp: marketCloseUTC('2025-01-08'), value: 81 },
    { timestamp: marketCloseUTC('2025-01-09'), value: 80 },
    { timestamp: marketCloseUTC('2025-01-10'), value: 81 },
  ],
};

const evalAt = new Date('2025-01-10T21:00:00.000Z');

// ---------------------------------------------------------------------------
// Test strategy
// ---------------------------------------------------------------------------

const testStrategy: Strategy = {
  linkId: 'strat-001',
  name: 'Test Strategy',
  trading: { frequency: 'Daily' as const, offset: 0 },
  allocations: [
    {
      name: 'Aggressive',
      allocation: {
        condition: {
          kind: 'signal' as const,
          signal: {
            left: { type: 'Price' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
            comparison: '>' as const,
            right: { type: 'SMA' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 5, delay: 0, unit: null, threshold: null },
            tolerance: 0,
          },
        },
        holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
      },
    },
    {
      name: 'Default',
      allocation: {
        condition: {
          kind: 'signal' as const,
          signal: {
            left: { type: 'Threshold' as const, ticker: { symbol: '', leverage: 1 }, lookback: 0, delay: 0, unit: null, threshold: 1 },
            comparison: '>' as const,
            right: { type: 'Threshold' as const, ticker: { symbol: '', leverage: 1 }, lookback: 0, delay: 0, unit: null, threshold: 0 },
            tolerance: 0,
          },
        },
        holdings: [{ ticker: { symbol: 'BND', leverage: 1 }, weight: 100 }],
      },
    },
  ],
  signals: [
    {
      name: 'SPY above SMA5',
      signal: {
        left: { type: 'Price' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
        comparison: '>' as const,
        right: { type: 'SMA' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 5, delay: 0, unit: null, threshold: null },
        tolerance: 0,
      },
    },
  ],
};

const testStrategy2: Strategy = {
  linkId: 'strat-002',
  name: 'Test Strategy 2',
  trading: { frequency: 'Daily' as const, offset: 0 },
  allocations: [
    {
      name: 'Risk On',
      allocation: {
        condition: {
          kind: 'signal' as const,
          signal: {
            left: { type: 'Price' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
            comparison: '>' as const,
            right: { type: 'SMA' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 3, delay: 0, unit: null, threshold: null },
            tolerance: 0,
          },
        },
        holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
      },
    },
    {
      name: 'Default',
      allocation: {
        condition: {
          kind: 'signal' as const,
          signal: {
            left: { type: 'Threshold' as const, ticker: { symbol: '', leverage: 1 }, lookback: 0, delay: 0, unit: null, threshold: 1 },
            comparison: '>' as const,
            right: { type: 'Threshold' as const, ticker: { symbol: '', leverage: 1 }, lookback: 0, delay: 0, unit: null, threshold: 0 },
            tolerance: 0,
          },
        },
        holdings: [{ ticker: { symbol: 'BND', leverage: 1 }, weight: 100 }],
      },
    },
  ],
  signals: [
    {
      name: 'SPY above SMA3',
      signal: {
        left: { type: 'Price' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
        comparison: '>' as const,
        right: { type: 'SMA' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 3, delay: 0, unit: null, threshold: null },
        tolerance: 0,
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Subscription fixtures
// ---------------------------------------------------------------------------

const sub1: SubscriptionForEvaluation = {
  userId: 'user-1',
  email: 'alice@example.com',
  strategyId: 1,
  strategyLinkId: 'strat-001',
  accountId: 'acc-1',
};

const sub2: SubscriptionForEvaluation = {
  userId: 'user-2',
  email: 'bob@example.com',
  strategyId: 1,
  strategyLinkId: 'strat-001',
  accountId: null,
};

const sub3: SubscriptionForEvaluation = {
  userId: 'user-3',
  email: 'charlie@example.com',
  strategyId: 2,
  strategyLinkId: 'strat-002',
  accountId: 'acc-3',
};

// ---------------------------------------------------------------------------
// DB mock builder
// ---------------------------------------------------------------------------

function buildMockFrom(
  mockRpc: ReturnType<typeof vi.fn>,
  overrides: {
    strategyRows?: Record<string, { id: number } | null>;
    previousAllocation?: Record<number, string | null>;
    tradingDayId?: number | null;
  } = {},
) {
  const {
    strategyRows = { 'strat-001': { id: 1 }, 'strat-002': { id: 2 } },
    previousAllocation = {},
    tradingDayId = 500,
  } = overrides;

  return (table: string) => {
    if (table === 'strategies') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((_col: string, linkId: string) => ({
            single: vi.fn().mockResolvedValue({
              data: strategyRows[linkId] ?? null,
              error: strategyRows[linkId] ? null : { message: 'Not found' },
            }),
          })),
        }),
      };
    }

    if (table === 'named_signals') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    }

    if (table === 'signal_evaluations') {
      return {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      };
    }

    if (table === 'evaluations') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((_col: string, stratId: number) => ({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: previousAllocation[stratId] !== undefined
                    ? { allocation_id: 99, allocations: { name: previousAllocation[stratId] } }
                    : null,
                  error: null,
                }),
              }),
            }),
          })),
        }),
      };
    }

    if (table === 'trading_days') {
      return {
        select: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: tradingDayId ? { id: tradingDayId } : null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    }

    // fallback
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluateSubscriptions', () => {
  let mock: ReturnType<typeof createMockClient>;
  let market: MarketModule;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
    market = createMockMarket(SERIES_DATA);
  });

  it('groups subscriptions by strategy and returns correct subscribers', async () => {
    mock.mockRpc.mockResolvedValue({ error: null });
    mock.mockFrom.mockImplementation(buildMockFrom(mock.mockRpc));

    const result = await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [sub1, sub2, sub3],
      strategies: { 'strat-001': testStrategy, 'strat-002': testStrategy2 },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.evaluations).toHaveLength(2);

    const entry1 = result.evaluations.find((e) => e.strategyLinkId === 'strat-001');
    expect(entry1).toBeDefined();
    expect(entry1!.subscribers).toHaveLength(2);
    expect(entry1!.subscribers.map((s) => s.userId)).toContain('user-1');
    expect(entry1!.subscribers.map((s) => s.userId)).toContain('user-2');

    const entry2 = result.evaluations.find((e) => e.strategyLinkId === 'strat-002');
    expect(entry2).toBeDefined();
    expect(entry2!.subscribers).toHaveLength(1);
    expect(entry2!.subscribers[0].userId).toBe('user-3');
  });

  it('evaluates each strategy with correct evaluation result', async () => {
    mock.mockRpc.mockResolvedValue({ error: null });
    mock.mockFrom.mockImplementation(buildMockFrom(mock.mockRpc));

    const result = await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [sub1],
      strategies: { 'strat-001': testStrategy },
    });

    expect(result.errors).toHaveLength(0);
    expect(result.evaluations).toHaveLength(1);

    const entry = result.evaluations[0];
    expect(entry.evaluation.allocation.name).toBe('Aggressive');
    expect(entry.evaluation.asOf).toBeInstanceOf(Date);
    expect(Object.keys(entry.evaluation.signals).length).toBeGreaterThan(0);
    expect(Object.keys(entry.evaluation.indicators).length).toBeGreaterThan(0);
    expect(entry.strategy).toBe(testStrategy);
  });

  it('detects allocation change when previous differs from current', async () => {
    mock.mockRpc.mockResolvedValue({ error: null });
    mock.mockFrom.mockImplementation(
      buildMockFrom(mock.mockRpc, {
        previousAllocation: { 1: 'Default' },
      }),
    );

    const result = await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [sub1],
      strategies: { 'strat-001': testStrategy },
    });

    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0].changed).toBe(true);
    expect(result.evaluations[0].previousAllocationName).toBe('Default');
  });

  it('detects no change when previous matches current', async () => {
    mock.mockRpc.mockResolvedValue({ error: null });
    mock.mockFrom.mockImplementation(
      buildMockFrom(mock.mockRpc, {
        previousAllocation: { 1: 'Aggressive' },
      }),
    );

    const result = await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [sub1],
      strategies: { 'strat-001': testStrategy },
    });

    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0].changed).toBe(false);
    expect(result.evaluations[0].previousAllocationName).toBe('Aggressive');
  });

  it('reports null previousAllocationName when no prior evaluation exists', async () => {
    mock.mockRpc.mockResolvedValue({ error: null });
    mock.mockFrom.mockImplementation(buildMockFrom(mock.mockRpc));

    const result = await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [sub1],
      strategies: { 'strat-001': testStrategy },
    });

    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0].previousAllocationName).toBeNull();
    expect(result.evaluations[0].changed).toBe(true);
  });

  it('isolates errors per strategy without failing the whole batch', async () => {
    mock.mockRpc.mockResolvedValue({ error: null });
    mock.mockFrom.mockImplementation(
      buildMockFrom(mock.mockRpc, {
        strategyRows: { 'strat-001': { id: 1 }, 'strat-002': null },
      }),
    );

    const result = await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [sub1, sub3],
      strategies: { 'strat-001': testStrategy, 'strat-002': testStrategy2 },
    });

    // strat-001 should succeed
    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0].strategyLinkId).toBe('strat-001');

    // strat-002 should error
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].strategyLinkId).toBe('strat-002');
    expect(result.errors[0].error).toContain('strat-002');
  });

  it('errors when strategy is missing from the strategies map', async () => {
    mock.mockRpc.mockResolvedValue({ error: null });
    mock.mockFrom.mockImplementation(buildMockFrom(mock.mockRpc));

    const result = await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [sub1],
      strategies: {}, // strategy not provided
    });

    expect(result.evaluations).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].strategyLinkId).toBe('strat-001');
    expect(result.errors[0].error).toContain('Strategy not found');
  });

  it('fetches all symbols from all strategies in one batch', async () => {
    mock.mockRpc.mockResolvedValue({ error: null });
    mock.mockFrom.mockImplementation(buildMockFrom(mock.mockRpc));

    await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [sub1, sub3],
      strategies: { 'strat-001': testStrategy, 'strat-002': testStrategy2 },
    });

    const getBatchSeries = market.getBatchSeries as ReturnType<typeof vi.fn>;
    expect(getBatchSeries).toHaveBeenCalledTimes(1);
    const symbols = getBatchSeries.mock.calls[0][0] as string[];
    expect(symbols).toContain('SPY');
    expect(symbols).toContain('BND');
  });

  it('stores evaluation via upsert_evaluation RPC', async () => {
    mock.mockRpc.mockResolvedValue({ error: null });
    mock.mockFrom.mockImplementation(buildMockFrom(mock.mockRpc));

    await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [sub1],
      strategies: { 'strat-001': testStrategy },
    });

    expect(mock.mockRpc).toHaveBeenCalledWith(
      'upsert_evaluation',
      expect.objectContaining({
        p_link_id: 'strat-001',
        p_allocation_name: 'Aggressive',
        p_trading_day_id: 500,
      }),
    );
  });

  it('skips store when no trading day is found', async () => {
    mock.mockRpc.mockResolvedValue({ error: null });
    mock.mockFrom.mockImplementation(
      buildMockFrom(mock.mockRpc, { tradingDayId: null }),
    );

    const result = await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [sub1],
      strategies: { 'strat-001': testStrategy },
    });

    expect(result.evaluations).toHaveLength(1);
    expect(mock.mockRpc).not.toHaveBeenCalled();
  });

  it('returns empty results for empty subscriptions', async () => {
    const result = await evaluateSubscriptions(mock.client, market, {
      at: evalAt,
      isEarly: false,
      subscriptions: [],
      strategies: {},
    });

    expect(result.evaluations).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
