import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStrategy } from './client';

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

function createMockClient() {
  const mockRpc = vi.fn();
  const mockFrom = vi.fn();
  const mockInvoke = vi.fn();

  const client = {
    from: mockFrom,
    rpc: mockRpc,
    functions: { invoke: mockInvoke },
  } as any;

  return { client, mockFrom, mockRpc, mockInvoke };
}

// ---------------------------------------------------------------------------
// Market data for evaluate tests
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
};

const evalAt = new Date('2025-01-10T21:00:00.000Z');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const STRATEGY_RESPONSE = {
  linkId: 'abc-123',
  name: 'Test Strategy',
  trading: { frequency: 'Daily', offset: 0 },
  signals: [
    {
      name: 'SPY above SMA50',
      signal: {
        left: { type: 'Price', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
        comparison: '>',
        right: { type: 'SMA', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 50, delay: 0, unit: null, threshold: null },
        tolerance: 0,
      },
    },
  ],
  allocations: [
    {
      name: 'Aggressive',
      position: 0,
      allocation: {
        condition: {
          kind: 'signal',
          signal: {
            left: { type: 'Price', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
            comparison: '>',
            right: { type: 'SMA', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 50, delay: 0, unit: null, threshold: null },
            tolerance: 0,
          },
        },
        holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
      },
    },
  ],
};

const INDICATOR_ROW_1 = {
  id: 10,
  type: 'Price',
  tickers: { symbol: 'SPY', leverage: 1 },
  lookback: 1,
  delay: 0,
  unit: null,
  threshold: null,
};

const INDICATOR_ROW_2 = {
  id: 11,
  type: 'SMA',
  tickers: { symbol: 'SPY', leverage: 1 },
  lookback: 50,
  delay: 0,
  unit: null,
  threshold: null,
};

const SIGNAL_ROW = {
  id: 100,
  indicator_1: INDICATOR_ROW_1,
  indicator_2: INDICATOR_ROW_2,
  comparison: '>',
  tolerance: 0,
};

const NAMED_SIGNAL_ROW = {
  name: 'SPY above SMA50',
  signal_id: 100,
  signals: SIGNAL_ROW,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createStrategy', () => {
  let mock: ReturnType<typeof createMockClient>;
  let strategy: ReturnType<typeof createStrategy>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
    strategy = createStrategy(mock.client);
  });

  // -----------------------------------------------------------------------
  // get(linkId)
  // -----------------------------------------------------------------------

  describe('get', () => {
    it('returns strategy from edge function', async () => {
      mock.mockInvoke.mockResolvedValue({ data: STRATEGY_RESPONSE, error: null });

      const result = await strategy.get('abc-123');

      expect(result).not.toBeNull();
      expect(result!.linkId).toBe('abc-123');
      expect(result!.name).toBe('Test Strategy');
      expect(result!.trading).toEqual({ frequency: 'Daily', offset: 0 });
      expect(result!.signals).toHaveLength(1);
      expect(result!.signals[0].name).toBe('SPY above SMA50');
      expect(result!.allocations).toHaveLength(1);
      expect(result!.allocations[0].name).toBe('Aggressive');
    });

    it('calls invoke with correct args', async () => {
      mock.mockInvoke.mockResolvedValue({ data: STRATEGY_RESPONSE, error: null });

      await strategy.get('abc-123');

      expect(mock.mockInvoke).toHaveBeenCalledWith('strategy', {
        body: { linkId: 'abc-123' },
      });
    });

    it('returns null when strategy not found', async () => {
      mock.mockInvoke.mockResolvedValue({ data: null, error: null });

      const result = await strategy.get('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null on invoke error', async () => {
      mock.mockInvoke.mockResolvedValue({ data: null, error: new Error('edge function error') });

      const result = await strategy.get('abc-123');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getMany(linkIds)
  // -----------------------------------------------------------------------

  describe('getMany', () => {
    it('returns empty record for empty input', async () => {
      const result = await strategy.getMany([]);
      expect(result).toEqual({});
    });

    it('returns strategies keyed by linkId', async () => {
      mock.mockInvoke.mockResolvedValue({ data: STRATEGY_RESPONSE, error: null });

      const result = await strategy.getMany(['abc-123']);
      expect(Object.keys(result)).toEqual(['abc-123']);
      expect(result['abc-123'].name).toBe('Test Strategy');
    });

    it('skips strategies that return null', async () => {
      mock.mockInvoke.mockResolvedValue({ data: null, error: null });

      const result = await strategy.getMany(['nonexistent']);
      expect(result).toEqual({});
    });
  });

  // -----------------------------------------------------------------------
  // evaluate (cache-through)
  // -----------------------------------------------------------------------

  describe('evaluate', () => {
    // A minimal in-memory strategy for evaluate tests
    const testStrategy = {
      linkId: 'abc-123',
      name: 'Test Strategy',
      trading: { frequency: 'Daily' as const, offset: 0 },
      allocations: [
        {
          name: 'Aggressive',
          position: 0,
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
          position: 1,
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

    // Helper: mock functions.invoke to return series data
    function mockSeriesInvoke() {
      mock.mockInvoke.mockResolvedValue({ data: SERIES_DATA, error: null });
    }

    // Helper: build a trading_days mock for ID resolution:
    // select().lte().order().limit().maybeSingle() → { id: 500 } or null
    function makeTradingDaysMock(idResult: { id: number } | null = { id: 500 }) {
      return () => ({
        select: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: idResult, error: null }),
              }),
            }),
          }),
        }),
      });
    }

    it('falls back to pure evaluation when strategy not in DB', async () => {
      mockSeriesInvoke();

      mock.mockFrom.mockImplementation(() => {
        // strategies query returns null
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      });

      const result = await strategy.evaluate(testStrategy, evalAt);

      expect(result.allocation.name).toBe('Aggressive');
      expect(result.asOf).toBeInstanceOf(Date);
      expect(Object.keys(result.indicators).length).toBeGreaterThan(0);
      expect(mock.mockRpc).not.toHaveBeenCalled();
    });

    it('falls back to pure evaluation when no trading day found', async () => {
      mockSeriesInvoke();

      mock.mockFrom.mockImplementation((table: string) => {
        if (table === 'strategies') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'trading_days') return makeTradingDaysMock(null)();
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      });

      const result = await strategy.evaluate(testStrategy, evalAt);

      expect(result.allocation.name).toBe('Aggressive');
      expect(result.asOf).toBeInstanceOf(Date);
      expect(mock.mockRpc).not.toHaveBeenCalled();
    });

    it('returns cached result on cache hit', async () => {
      mockSeriesInvoke();

      mock.mockFrom.mockImplementation((table: string) => {
        if (table === 'strategies') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'trading_days') return makeTradingDaysMock()();
        if (table === 'strategy_evaluations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { allocation_id: 200 },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'allocations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { name: 'Aggressive' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'named_signals') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [NAMED_SIGNAL_ROW], error: null }),
            }),
          };
        }
        if (table === 'signal_evaluations') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [{ signal_id: 100, result: true }],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'indicator_evaluations') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    { indicator_id: 10, value: 500, metadata: null, trading_days: { post: '2025-01-10T21:00:00Z' } },
                    { indicator_id: 11, value: 480, metadata: { sma: [1, 2] }, trading_days: { post: '2025-01-10T21:00:00Z' } },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      });

      const result = await strategy.evaluate(testStrategy, evalAt);

      expect(result.allocation.name).toBe('Aggressive');
      expect(result.asOf).toBeInstanceOf(Date);
      expect(Object.keys(result.indicators).length).toBe(2);
      // Verify indicator values are reconstructed from cache
      const indKeys = Object.keys(result.indicators);
      expect(result.indicators[indKeys[0]].value).toBe(500);
      expect(result.indicators[indKeys[1]].value).toBe(480);
      expect(result.indicators[indKeys[1]].metadata).toEqual({ sma: [1, 2] });
      // No RPC call on cache hit
      expect(mock.mockRpc).not.toHaveBeenCalled();
    });

    it('computes and stores on cache miss', async () => {
      mockSeriesInvoke();
      mock.mockRpc.mockResolvedValue({ error: null });

      mock.mockFrom.mockImplementation((table: string) => {
        if (table === 'strategies') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'trading_days') return makeTradingDaysMock()();
        if (table === 'strategy_evaluations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
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
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      });

      const result = await strategy.evaluate(testStrategy, evalAt);

      expect(result.allocation.name).toBe('Aggressive');
      expect(result.asOf).toBeInstanceOf(Date);
      expect(Object.keys(result.indicators).length).toBeGreaterThan(0);

      // Wait for non-blocking store
      await vi.waitFor(() => {
        expect(mock.mockRpc).toHaveBeenCalledWith('upsert_evaluation', expect.objectContaining({
          p_link_id: 'abc-123',
          p_allocation_name: 'Aggressive',
        }));
      });
    });

    it('does not propagate store failure', async () => {
      mockSeriesInvoke();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mock.mockRpc.mockResolvedValue({ error: { message: 'DB error' } });

      mock.mockFrom.mockImplementation((table: string) => {
        if (table === 'strategies') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'trading_days') return makeTradingDaysMock()();
        if (table === 'strategy_evaluations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  }),
                }),
              }),
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
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        };
      });

      // Should not throw even though store fails
      const result = await strategy.evaluate(testStrategy, evalAt);

      expect(result.allocation.name).toBe('Aggressive');
      expect(result.asOf).toBeInstanceOf(Date);

      // Wait for non-blocking store error to be logged
      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to store evaluation:',
          expect.any(Error),
        );
      });

      consoleSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // backtest (stub)
  // -----------------------------------------------------------------------

  describe('backtest', () => {
    it('throws "Not implemented"', async () => {
      await expect(
        strategy.backtest(
          { linkId: 'x', name: 'x', trading: { frequency: 'Daily', offset: 0 }, allocations: [], signals: [] },
          { startDate: '2020-01-01', endDate: '2025-01-01' },
        ),
      ).rejects.toThrow('Not implemented');
    });
  });
});
