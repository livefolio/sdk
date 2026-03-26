import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateCached } from './cache';
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
};

const evalAt = new Date('2025-01-10T21:00:00.000Z');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

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

const testStrategy: Strategy = {
  linkId: 'abc-123',
  name: 'Test Strategy',
  trading: { frequency: 'Daily' as const, offset: 0 },
  allocations: {
    Aggressive: {
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
    Default: {
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
  signals: {
    'SPY above SMA5': {
      left: { type: 'Price' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
      comparison: '>' as const,
      right: { type: 'SMA' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 5, delay: 0, unit: null, threshold: null },
      tolerance: 0,
    },
  },
};

// Helper: build a trading_days mock
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('evaluateCached', () => {
  let mock: ReturnType<typeof createMockClient>;
  let market: MarketModule;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
    market = createMockMarket(SERIES_DATA);
  });

  it('falls back to pure evaluation when strategy not in DB', async () => {
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }));

    const result = await evaluateCached(mock.client, market, testStrategy, evalAt);

    expect(result.allocation.name).toBe('Aggressive');
    expect(result.asOf).toBeInstanceOf(Date);
    expect(Object.keys(result.indicators).length).toBeGreaterThan(0);
    expect(mock.mockRpc).not.toHaveBeenCalled();
  });

  it('falls back to pure evaluation when no trading day found', async () => {
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

    const result = await evaluateCached(mock.client, market, testStrategy, evalAt);

    expect(result.allocation.name).toBe('Aggressive');
    expect(result.asOf).toBeInstanceOf(Date);
    expect(mock.mockRpc).not.toHaveBeenCalled();
  });

  it('returns cached result on cache hit', async () => {
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

    const result = await evaluateCached(mock.client, market, testStrategy, evalAt);

    expect(result.allocation.name).toBe('Aggressive');
    expect(result.asOf).toBeInstanceOf(Date);
    expect(Object.keys(result.indicators).length).toBe(2);
    const indKeys = Object.keys(result.indicators);
    expect(result.indicators[indKeys[0]].value).toBe(500);
    expect(result.indicators[indKeys[1]].value).toBe(480);
    expect(result.indicators[indKeys[1]].metadata).toEqual({ sma: [1, 2] });
    expect(mock.mockRpc).not.toHaveBeenCalled();
  });

  it('computes and stores on cache miss', async () => {
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

    const result = await evaluateCached(mock.client, market, testStrategy, evalAt);

    expect(result.allocation.name).toBe('Aggressive');
    expect(result.asOf).toBeInstanceOf(Date);
    expect(Object.keys(result.indicators).length).toBeGreaterThan(0);

    await vi.waitFor(() => {
      expect(mock.mockRpc).toHaveBeenCalledWith('upsert_evaluation', expect.objectContaining({
        p_link_id: 'abc-123',
        p_allocation_name: 'Aggressive',
      }));
    });
  });

  it('includes signal name in upsert_evaluation call for shadow mode', async () => {
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

    await evaluateCached(mock.client, market, testStrategy, evalAt);

    await vi.waitFor(() => {
      expect(mock.mockRpc).toHaveBeenCalledWith('upsert_evaluation', expect.objectContaining({
        p_signal_results: expect.arrayContaining([
          expect.objectContaining({ name: 'SPY above SMA5' }),
        ]),
      }));
    });
  });

  it('does not propagate store failure', async () => {
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

    const result = await evaluateCached(mock.client, market, testStrategy, evalAt);

    expect(result.allocation.name).toBe('Aggressive');
    expect(result.asOf).toBeInstanceOf(Date);

    await vi.waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to store evaluation:',
        expect.any(Error),
      );
    });

    consoleSpy.mockRestore();
  });
});
