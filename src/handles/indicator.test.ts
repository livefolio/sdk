import { describe, it, expect, vi } from 'vitest';
import { IndicatorHandle } from './indicator';
import { TickerHandle } from './ticker';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

function mockStorage(overrides?: Partial<StorageProvider>): StorageProvider {
  return {
    tickers: {
      upsert: vi.fn().mockResolvedValue({ id: 1 }),
    },
    indicators: {
      upsert: vi.fn().mockResolvedValue({ id: 10 }),
      getSeries: vi.fn().mockResolvedValue([]),
      writeSeries: vi.fn().mockResolvedValue(undefined),
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getValue: vi.fn().mockResolvedValue(null),
    },
    signals: {
      upsert: vi.fn().mockResolvedValue({ id: 1 }),
      getSeries: vi.fn().mockResolvedValue([]),
      writeSeries: vi.fn().mockResolvedValue(undefined),
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getLastValue: vi.fn().mockResolvedValue(null),
    },
    allocations: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
    },
    strategies: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      getSeries: vi.fn().mockResolvedValue([]),
      writeSeries: vi.fn().mockResolvedValue(undefined),
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      resolveReference: vi.fn().mockResolvedValue({}),
    },
    tradingDays: {
      getRange: vi.fn().mockResolvedValue([]),
      getLatestClosed: vi.fn().mockResolvedValue(null),
    },
    ...overrides,
  } as StorageProvider;
}

function mockMarket(overrides?: Partial<MarketProvider>): MarketProvider {
  return {
    fetchBars: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('IndicatorHandle', () => {
  it('stores identity params with a ticker', () => {
    const storage = mockStorage();
    const market = mockMarket();
    const ticker = new TickerHandle(storage, 'SPY');
    const handle = new IndicatorHandle(storage, market, {
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
    const storage = mockStorage();
    const market = mockMarket();
    const handle = new IndicatorHandle(storage, market, {
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
    const storage = mockStorage();
    const market = mockMarket();
    const handle = new IndicatorHandle(storage, market, {
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

describe('IndicatorHandle.resolve', () => {
  it('resolves ticker first, then upserts indicator with ticker_id', async () => {
    const storage = mockStorage({
      tickers: { upsert: vi.fn().mockResolvedValue({ id: 1 }) },
      indicators: {
        upsert: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket();
    const ticker = new TickerHandle(storage, 'SPY');
    const handle = new IndicatorHandle(storage, market, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const result = await handle.resolve();

    expect(result).toEqual({ id: 10 });
    expect(handle.id).toBe(10);
    expect(storage.tickers.upsert).toHaveBeenCalledWith('SPY', 1);
    expect(storage.indicators.upsert).toHaveBeenCalledWith({
      type: 'SMA',
      tickerId: 1,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });
  });

  it('resolves standalone indicator without ticker', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 20 });
    const storage = mockStorage({
      indicators: {
        upsert,
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket();

    const handle = new IndicatorHandle(storage, market, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const result = await handle.resolve();
    expect(result).toEqual({ id: 20 });
    expect(handle.id).toBe(20);
    expect(upsert).toHaveBeenCalledWith({
      type: 'VIX',
      tickerId: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
  });

  it('caches resolution', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 20 });
    const storage = mockStorage({
      indicators: {
        upsert,
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket();

    const handle = new IndicatorHandle(storage, market, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.resolve();
    await handle.resolve();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 20 });
    const storage = mockStorage({
      indicators: {
        upsert,
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket();

    const handle = new IndicatorHandle(storage, market, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);
    expect(r1).toEqual({ id: 20 });
    expect(r2).toEqual({ id: 20 });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
