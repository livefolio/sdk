import { describe, it, expect, vi } from 'vitest';
import { StrategyHandle } from './strategy.js';
import { SignalHandle } from './signal.js';
import { AllocationHandle } from './allocation.js';
import { IndicatorHandle } from './indicator.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

const sb = {} as TypedSupabaseClient;

function makeSignal() {
  const ind1 = new IndicatorHandle(sb, {
    type: 'VIX',
    ticker: null,
    lookback: 0,
    delay: 0,
    unit: null,
    threshold: null,
  });
  const ind2 = new IndicatorHandle(sb, {
    type: 'Threshold',
    ticker: null,
    lookback: 0,
    delay: 0,
    unit: null,
    threshold: 30,
  });
  return new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 0 });
}

function makeAllocation() {
  return new AllocationHandle(sb, [[new TickerHandle(sb, 'SPY'), 1.0]]);
}

describe('StrategyHandle construction - create mode', () => {
  it('stores options with defaults', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(sb, { name: 'Test', rules: [{ hold: alloc }] });
    expect(handle.name).toBe('Test');
    expect(handle.freq).toBe('Daily');
    expect(handle.offset).toBe(0);
    expect(handle.rules).toHaveLength(1);
  });

  it('stores explicit freq and offset', () => {
    const signal = makeSignal();
    const alloc1 = makeAllocation();
    const alloc2 = makeAllocation();
    const handle = new StrategyHandle(sb, {
      name: 'Tactical',
      freq: 'Monthly',
      offset: 2,
      rules: [{ when: [signal], hold: alloc1 }, { hold: alloc2 }],
    });
    expect(handle.freq).toBe('Monthly');
    expect(handle.offset).toBe(2);
    expect(handle.rules).toHaveLength(2);
  });

  it('throws if rules array is empty', () => {
    expect(() => new StrategyHandle(sb, { name: 'Empty', rules: [] })).toThrow('at least one rule');
  });

  it('throws if last rule has a when clause', () => {
    const signal = makeSignal();
    const alloc = makeAllocation();
    expect(() => new StrategyHandle(sb, { name: 'Bad', rules: [{ when: [signal], hold: alloc }] })).toThrow('fallback');
  });

  it('throws on .id before resolution', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(sb, { name: 'Test', rules: [{ hold: alloc }] });
    expect(() => handle.id).toThrow('not yet resolved');
  });

  it('throws on .link before resolution', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(sb, { name: 'Test', rules: [{ hold: alloc }] });
    expect(() => handle.link).toThrow('not yet resolved');
  });
});

describe('StrategyHandle construction - reference mode', () => {
  it('stores linkId with defaults', () => {
    const handle = new StrategyHandle(sb, 'abc123');
    expect(handle.name).toBeNull();
    expect(handle.freq).toBe('Daily');
    expect(handle.offset).toBe(0);
    expect(handle.rules).toHaveLength(0);
  });
});

describe('StrategyHandle.resolve - create mode', () => {
  it('resolves dependencies, generates link_id, and inserts strategy', async () => {
    const indicatorRow = {
      id: 10,
      type: 'VIX',
      ticker_id: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
      created_at: '',
    };
    const thresholdRow = {
      id: 11,
      type: 'Threshold',
      ticker_id: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: 30,
      created_at: '',
    };
    const signalRow = {
      id: 100,
      indicator_id_1: 10,
      indicator_id_2: 11,
      comparison: '>',
      tolerance: 0,
      created_at: '',
    };
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const allocRow = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };
    const strategyRow = {
      id: 200,
      link_id: 'generated-id',
      name: 'Test',
      trading_freq: 'Daily',
      trading_offset: 0,
      definition: {},
      created_at: '',
    };

    let indCallCount = 0;
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: strategyRow, error: null }),
      }),
    });

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'indicators') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(() => {
                indCallCount++;
                return Promise.resolve({
                  data: indCallCount <= 1 ? indicatorRow : thresholdRow,
                  error: null,
                });
              }),
            }),
          }),
        };
      }
      if (table === 'signals') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: signalRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: tickerRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'allocations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: allocRow, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'strategies') {
        return { insert: insertMock };
      }
      return {};
    });
    const mockSb = { from } as unknown as TypedSupabaseClient;

    const signal = new SignalHandle(mockSb, {
      indicator1: new IndicatorHandle(mockSb, {
        type: 'VIX',
        ticker: null,
        lookback: 0,
        delay: 0,
        unit: null,
        threshold: null,
      }),
      indicator2: new IndicatorHandle(mockSb, {
        type: 'Threshold',
        ticker: null,
        lookback: 0,
        delay: 0,
        unit: null,
        threshold: 30,
      }),
      comparison: '>',
      tolerance: 0,
    });
    const alloc1 = new AllocationHandle(mockSb, [[new TickerHandle(mockSb, 'SPY'), 1.0]]);
    const alloc2 = new AllocationHandle(mockSb, [[new TickerHandle(mockSb, 'SPY'), 1.0]]);

    const handle = new StrategyHandle(mockSb, {
      name: 'Test',
      rules: [{ when: [signal], hold: alloc1 }, { hold: alloc2 }],
    });

    const result = await handle.resolve();

    expect(result.id).toBe(200);
    expect(handle.id).toBe(200);
    expect(handle.link).toBeDefined();
    expect(insertMock).toHaveBeenCalled();
    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg.name).toBe('Test');
    expect(insertArg.link_id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(insertArg.definition.rules).toHaveLength(2);
    expect(insertArg.definition.rules[0].signalIds).toEqual([100]);
    expect(insertArg.definition.rules[0].allocationId).toBe(50);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const strategyRow = {
      id: 200,
      link_id: 'x',
      name: 'Test',
      trading_freq: 'Daily',
      trading_offset: 0,
      definition: {},
      created_at: '',
    };
    const allocRow = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };

    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: strategyRow, error: null }),
      }),
    });
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: tickerRow, error: null }) }),
          }),
        };
      }
      if (table === 'allocations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: allocRow, error: null }) }),
            }),
          }),
        };
      }
      if (table === 'strategies') {
        return { insert: insertMock };
      }
      return {};
    });
    const mockSb = { from } as unknown as TypedSupabaseClient;

    const alloc = new AllocationHandle(mockSb, [[new TickerHandle(mockSb, 'SPY'), 1.0]]);
    const handle = new StrategyHandle(mockSb, { name: 'Test', rules: [{ hold: alloc }] });

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);
    expect(r1).toEqual(r2);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe('StrategyHandle.resolve - reference mode', () => {
  it('fetches strategy by link_id and reconstructs rules', async () => {
    const strategyRow = {
      id: 200,
      link_id: 'abc123',
      name: 'Tactical',
      trading_freq: 'Monthly',
      trading_offset: 2,
      definition: {
        rules: [
          { signalIds: [100], allocationId: 50 },
          { signalIds: [], allocationId: 51 },
        ],
      },
      created_at: '',
    };
    const signalRow = {
      id: 100,
      indicator_id_1: 10,
      indicator_id_2: 11,
      comparison: '>',
      tolerance: 5,
      created_at: '',
    };
    const indicatorRow1 = {
      id: 10,
      type: 'Price',
      ticker_id: 1,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
      created_at: '',
    };
    const indicatorRow2 = {
      id: 11,
      type: 'SMA',
      ticker_id: 1,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
      created_at: '',
    };
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const allocRow1 = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };
    const allocRow2 = { id: 51, holdings: { SHY: 1.0 }, created_at: '' };

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'strategies') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: strategyRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'signals') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [signalRow], error: null }),
          }),
        };
      }
      if (table === 'indicators') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [indicatorRow1, indicatorRow2], error: null }),
          }),
        };
      }
      if (table === 'tickers') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [tickerRow], error: null }),
          }),
        };
      }
      if (table === 'allocations') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [allocRow1, allocRow2], error: null }),
          }),
        };
      }
      return {};
    });
    const mockSb = { from } as unknown as TypedSupabaseClient;

    const handle = new StrategyHandle(mockSb, 'abc123');
    const result = await handle.resolve();

    expect(result.id).toBe(200);
    expect(handle.id).toBe(200);
    expect(handle.link).toBe('abc123');
    expect(handle.name).toBe('Tactical');
    expect(handle.freq).toBe('Monthly');
    expect(handle.offset).toBe(2);
    expect(handle.rules).toHaveLength(2);
    expect(handle.rules[0].when).toHaveLength(1);
    expect(handle.rules[0].when![0].comparison).toBe('>');
    expect(handle.rules[0].hold.id).toBe(50);
    expect(handle.rules[1].when).toBeUndefined();
    expect(handle.rules[1].hold.id).toBe(51);
  });

  it('throws on invalid link_id', async () => {
    const from = vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116', message: 'not found' },
          }),
        }),
      }),
    }));
    const mockSb = { from } as unknown as TypedSupabaseClient;

    const handle = new StrategyHandle(mockSb, 'invalid');
    await expect(handle.resolve()).rejects.toThrow();
  });
});
