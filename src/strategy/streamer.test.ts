import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStreamer } from './streamer';
import type { MarketModule } from '../market/types';
import type { Strategy } from './types';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockClient() {
  const mockFrom = vi.fn();
  const client = { from: mockFrom } as any;
  return { client, mockFrom };
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

const testStrategy: Strategy = {
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

function mockClientNoStrategy(mockFrom: ReturnType<typeof vi.fn>) {
  mockFrom.mockImplementation(() => ({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createStreamer', () => {
  let mock: ReturnType<typeof createMockClient>;
  let market: MarketModule;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
    market = createMockMarket();
  });

  it('fetches series and prior state during initialization', async () => {
    mockClientNoStrategy(mock.mockFrom);

    const streamer = await createStreamer(mock.client, market, testStrategy);

    expect(market.getBatchSeries).toHaveBeenCalledTimes(1);
    expect(market.getBatchSeries).toHaveBeenCalledWith(['SPY', 'BND']);
    expect(streamer.update).toBeTypeOf('function');
  });

  it('update() merges observation and returns valid evaluation', async () => {
    mockClientNoStrategy(mock.mockFrom);

    const streamer = await createStreamer(mock.client, market, testStrategy);
    const result = streamer.update({
      symbol: 'SPY',
      timestamp: '2025-01-10T19:30:00.000Z',
      value: 110,
    });

    expect(result.asOf).toBeInstanceOf(Date);
    expect(result.allocation).toBeDefined();
    expect(result.allocation.name).toBeDefined();
    expect(Object.keys(result.indicators).length).toBeGreaterThan(0);
  });

  it('update() is synchronous — no promise returned', async () => {
    mockClientNoStrategy(mock.mockFrom);

    const streamer = await createStreamer(mock.client, market, testStrategy);
    const result = streamer.update({
      symbol: 'SPY',
      timestamp: '2025-01-10T19:30:00.000Z',
      value: 110,
    });

    // Should not be a promise
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.allocation).toBeDefined();
  });

  it('state carries forward between consecutive update() calls (signal hysteresis)', async () => {
    mockClientNoStrategy(mock.mockFrom);

    const streamer = await createStreamer(mock.client, market, testStrategy);

    // First update — SPY price 110 is well above SMA5 (~102), signal should be true
    const result1 = streamer.update({
      symbol: 'SPY',
      timestamp: '2025-01-10T19:30:00.000Z',
      value: 110,
    });
    expect(result1.allocation.name).toBe('Aggressive');

    // Second update — price drops to 50, well below SMA, signal should flip
    const result2 = streamer.update({
      symbol: 'SPY',
      timestamp: '2025-01-10T19:35:00.000Z',
      value: 50,
    });

    // The signal states from result1 should have been carried forward as previousSignalStates
    // The evaluation should use the new price
    expect(result2.allocation).toBeDefined();
    expect(result2.allocation.name).toBe('Default');
  });

  it('throws on empty observations array', async () => {
    mockClientNoStrategy(mock.mockFrom);

    const streamer = await createStreamer(mock.client, market, testStrategy);

    expect(() => streamer.update([])).toThrow('update() requires at least one observation');
  });

  it('single observation matches array-wrapped observation', async () => {
    mockClientNoStrategy(mock.mockFrom);

    const obs = { symbol: 'SPY', timestamp: '2025-01-10T19:30:00.000Z', value: 110 };

    // Create two separate streamers so they have identical starting state
    const streamer1 = await createStreamer(mock.client, market, testStrategy);
    const streamer2 = await createStreamer(mock.client, market, testStrategy);

    const resultBare = streamer1.update(obs);
    const resultArray = streamer2.update([obs]);

    expect(resultBare.asOf).toEqual(resultArray.asOf);
    expect(resultBare.allocation.name).toBe(resultArray.allocation.name);
    expect(resultBare.signals).toEqual(resultArray.signals);
  });

  it('does not fetch series again on update()', async () => {
    mockClientNoStrategy(mock.mockFrom);

    const streamer = await createStreamer(mock.client, market, testStrategy);

    // getBatchSeries called once during init
    expect(market.getBatchSeries).toHaveBeenCalledTimes(1);

    streamer.update({ symbol: 'SPY', timestamp: '2025-01-10T19:30:00.000Z', value: 110 });
    streamer.update({ symbol: 'SPY', timestamp: '2025-01-10T19:35:00.000Z', value: 111 });

    // Still only called once
    expect(market.getBatchSeries).toHaveBeenCalledTimes(1);
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

    const streamer = await createStreamer(mock.client, market, testStrategy);
    expect(mock.mockFrom).toHaveBeenCalledWith('named_signals');

    const result = streamer.update({
      symbol: 'SPY',
      timestamp: '2025-01-10T19:30:00.000Z',
      value: 110,
    });
    expect(result.allocation).toBeDefined();
  });
});
