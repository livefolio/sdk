import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stream } from './stream';
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
    { timestamp: marketCloseUTC('2025-01-06'), value: 70 },
    { timestamp: marketCloseUTC('2025-01-07'), value: 71 },
    { timestamp: marketCloseUTC('2025-01-08'), value: 70.5 },
    { timestamp: marketCloseUTC('2025-01-09'), value: 71.2 },
    { timestamp: marketCloseUTC('2025-01-10'), value: 71.5 },
  ],
};

function createMockMarket(): MarketModule {
  return {
    getBatchSeries: vi.fn().mockResolvedValue(SERIES_DATA),
  } as any;
}

const streamStrategy: Strategy = {
  linkId: 'abc-123',
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('stream', () => {
  let mock: ReturnType<typeof createMockClient>;
  let market: MarketModule;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
    market = createMockMarket();
  });

  it('merges observation into series and returns valid evaluation', async () => {
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }));

    const result = await stream(mock.client, market, streamStrategy, {
      symbol: 'SPY',
      timestamp: '2025-01-10T19:30:00.000Z',
      value: 110,
    });

    expect(result.asOf).toBeInstanceOf(Date);
    expect(result.allocation).toBeDefined();
    expect(result.allocation.name).toBeDefined();
    expect(Object.keys(result.indicators).length).toBeGreaterThan(0);
  });

  it('replaces same-date entry when observation matches existing date', async () => {
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }));

    const result = await stream(mock.client, market, streamStrategy, {
      symbol: 'SPY',
      timestamp: '2025-01-10T19:30:00.000Z',
      value: 200,
    });

    const priceKey = Object.keys(result.indicators).find(k => k.startsWith('Price_SPY'));
    expect(priceKey).toBeDefined();
    expect(result.indicators[priceKey!].value).toBe(200);
  });

  it('skips cache check and does not store result', async () => {
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }));

    await stream(mock.client, market, streamStrategy, {
      symbol: 'SPY',
      timestamp: '2025-01-10T19:30:00.000Z',
      value: 110,
    });

    expect(mock.mockRpc).not.toHaveBeenCalled();
  });

  it('fetches prior signal states when strategy exists in DB', async () => {
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

    const result = await stream(mock.client, market, streamStrategy, {
      symbol: 'SPY',
      timestamp: '2025-01-10T19:30:00.000Z',
      value: 110,
    });

    expect(result.allocation).toBeDefined();
    expect(mock.mockFrom).toHaveBeenCalledWith('named_signals');
    expect(mock.mockRpc).not.toHaveBeenCalled();
  });

  it('accepts multiple observations for different symbols', async () => {
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }));

    const result = await stream(mock.client, market, streamStrategy, [
      { symbol: 'SPY', timestamp: '2025-01-10T19:30:00.000Z', value: 110 },
      { symbol: 'BND', timestamp: '2025-01-10T19:30:00.000Z', value: 72 },
    ]);

    expect(result.asOf).toBeInstanceOf(Date);
    expect(result.allocation).toBeDefined();
    expect(market.getBatchSeries).toHaveBeenCalledTimes(1);
  });

  it('last observation wins for same symbol same date', async () => {
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }));

    const result = await stream(mock.client, market, streamStrategy, [
      { symbol: 'SPY', timestamp: '2025-01-10T19:00:00.000Z', value: 105 },
      { symbol: 'SPY', timestamp: '2025-01-10T19:30:00.000Z', value: 200 },
    ]);

    const priceKey = Object.keys(result.indicators).find(k => k.startsWith('Price_SPY'));
    expect(priceKey).toBeDefined();
    expect(result.indicators[priceKey!].value).toBe(200);
  });

  it('uses latest observation timestamp as evaluation date', async () => {
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }));

    // Use market-close timestamps so getEvaluationDate can find them
    const result = await stream(mock.client, market, streamStrategy, [
      { symbol: 'SPY', timestamp: marketCloseUTC('2025-01-09'), value: 105 },
      { symbol: 'SPY', timestamp: marketCloseUTC('2025-01-10'), value: 110 },
    ]);

    // asOf should be derived from the latest observation date (Jan 10)
    expect(result.asOf.toISOString().slice(0, 10)).toBe('2025-01-10');
  });

  it('throws on empty array', async () => {
    await expect(
      stream(mock.client, market, streamStrategy, []),
    ).rejects.toThrow('stream() requires at least one observation');
  });

  it('single-element array matches bare observation behavior', async () => {
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }));

    const obs = { symbol: 'SPY', timestamp: '2025-01-10T19:30:00.000Z', value: 110 };
    const [resultBare, resultArray] = await Promise.all([
      stream(mock.client, market, streamStrategy, obs),
      stream(mock.client, market, streamStrategy, [obs]),
    ]);

    expect(resultBare.asOf).toEqual(resultArray.asOf);
    expect(resultBare.allocation.name).toBe(resultArray.allocation.name);
    expect(resultBare.signals).toEqual(resultArray.signals);
  });
});
