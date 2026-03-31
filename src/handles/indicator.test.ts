import { describe, it, expect, vi } from 'vitest';
import { IndicatorHandle } from './indicator.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

function mockSupabase() {
  return {} as TypedSupabaseClient;
}

describe('IndicatorHandle', () => {
  it('stores identity params with a ticker', () => {
    const sb = mockSupabase();
    const ticker = new TickerHandle(sb, 'SPY');
    const handle = new IndicatorHandle(sb, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });

    expect(handle.type).toBe('SMA');
    expect(handle.ticker).toBe(ticker);
    expect(handle.lookback).toBe(200);
  });

  it('stores identity params without a ticker', () => {
    const sb = mockSupabase();
    const handle = new IndicatorHandle(sb, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    expect(handle.type).toBe('VIX');
    expect(handle.ticker).toBeNull();
  });

  it('throws on .id before resolution', () => {
    const sb = mockSupabase();
    const handle = new IndicatorHandle(sb, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    expect(() => handle.id).toThrow('not yet resolved');
  });
});

function mockSupabaseChained(tickerRow: Record<string, unknown>, indicatorRow: Record<string, unknown>) {
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
      return {
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: indicatorRow, error: null }),
          }),
        }),
      };
    }
    return {};
  });
  return { from } as unknown as TypedSupabaseClient;
}

describe('IndicatorHandle.resolve', () => {
  it('resolves ticker first, then upserts indicator with ticker_id', async () => {
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const indicatorRow = {
      id: 10,
      type: 'SMA',
      ticker_id: 1,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
      created_at: '',
    };
    const sb = mockSupabaseChained(tickerRow, indicatorRow);
    const ticker = new TickerHandle(sb, 'SPY');
    const handle = new IndicatorHandle(sb, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const result = await handle.resolve();

    expect(result).toEqual(indicatorRow);
    expect(handle.id).toBe(10);
    expect(sb.from).toHaveBeenCalledWith('tickers');
    expect(sb.from).toHaveBeenCalledWith('indicators');
  });

  it('resolves standalone indicator without ticker', async () => {
    const indicatorRow = {
      id: 20,
      type: 'VIX',
      ticker_id: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
      created_at: '',
    };
    const single = vi.fn().mockResolvedValue({ data: indicatorRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });
    const sb = { from } as unknown as TypedSupabaseClient;

    const handle = new IndicatorHandle(sb, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const result = await handle.resolve();
    expect(result).toEqual(indicatorRow);
    expect(handle.id).toBe(20);
  });

  it('caches resolution', async () => {
    const indicatorRow = {
      id: 20,
      type: 'VIX',
      ticker_id: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
      created_at: '',
    };
    const single = vi.fn().mockResolvedValue({ data: indicatorRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });
    const sb = { from } as unknown as TypedSupabaseClient;

    const handle = new IndicatorHandle(sb, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.resolve();
    await handle.resolve();
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const indicatorRow = {
      id: 20,
      type: 'VIX',
      ticker_id: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
      created_at: '',
    };
    const single = vi.fn().mockResolvedValue({ data: indicatorRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });
    const sb = { from } as unknown as TypedSupabaseClient;

    const handle = new IndicatorHandle(sb, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);
    expect(r1).toEqual(indicatorRow);
    expect(r2).toEqual(indicatorRow);
    expect(from).toHaveBeenCalledTimes(1);
  });
});
