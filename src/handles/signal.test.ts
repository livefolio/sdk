// src/handles/signal.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SignalHandle } from './signal.js';
import { IndicatorHandle } from './indicator.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

function mockSupabase() {
  return {} as TypedSupabaseClient;
}

describe('SignalHandle construction', () => {
  it('stores indicator handles, comparison, and tolerance', () => {
    const sb = mockSupabase();
    const ticker = new TickerHandle(sb, 'SPY');
    const ind1 = new IndicatorHandle(sb, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = new IndicatorHandle(sb, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 5 });

    expect(handle.indicator1).toBe(ind1);
    expect(handle.indicator2).toBe(ind2);
    expect(handle.comparison).toBe('>');
    expect(handle.tolerance).toBe(5);
  });

  it('stores zero tolerance', () => {
    const sb = mockSupabase();
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
      threshold: 20,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '<', tolerance: 0 });
    expect(handle.tolerance).toBe(0);
  });

  it('throws on .id before resolution', () => {
    const sb = mockSupabase();
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
      threshold: 20,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 0 });
    expect(() => handle.id).toThrow('not yet resolved');
  });
});

describe('SignalHandle.resolve', () => {
  it('resolves both indicators then upserts signal', async () => {
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
    const signalRow = {
      id: 100,
      indicator_id_1: 10,
      indicator_id_2: 11,
      comparison: '>',
      tolerance: 5,
      created_at: '',
    };

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: tickerRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'indicators') {
        let callCount = 0;
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(() => {
                callCount++;
                return Promise.resolve({
                  data: callCount === 1 ? indicatorRow1 : indicatorRow2,
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
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

    const ticker = new TickerHandle(sb, 'SPY');
    const ind1 = new IndicatorHandle(sb, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = new IndicatorHandle(sb, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 5 });

    const result = await handle.resolve();

    expect(result).toEqual(signalRow);
    expect(handle.id).toBe(100);
    expect(sb.from).toHaveBeenCalledWith('signals');
  });

  it('caches resolution', async () => {
    const signalRow = {
      id: 100,
      indicator_id_1: 10,
      indicator_id_2: 11,
      comparison: '>',
      tolerance: 0,
      created_at: '',
    };
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

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'indicators') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: indicatorRow, error: null }),
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
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

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
      threshold: 20,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 0 });

    await handle.resolve();
    await handle.resolve();

    const signalCalls = from.mock.calls.filter((c: string[]) => c[0] === 'signals');
    expect(signalCalls.length).toBe(1);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const signalRow = {
      id: 100,
      indicator_id_1: 10,
      indicator_id_2: 11,
      comparison: '>',
      tolerance: 0,
      created_at: '',
    };
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

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'indicators') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: indicatorRow, error: null }),
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
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

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
      threshold: 20,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 0 });

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);
    expect(r1).toEqual(r2);
    const signalCalls = from.mock.calls.filter((c: string[]) => c[0] === 'signals');
    expect(signalCalls.length).toBe(1);
  });
});
