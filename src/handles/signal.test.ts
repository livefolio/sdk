// src/handles/signal.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SignalHandle } from './signal.js';
import { IndicatorHandle } from './indicator.js';
import { TickerHandle } from './ticker.js';
import type { StorageProvider } from '../providers/storage.js';
import type { MarketProvider } from '../providers/market.js';

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
      upsert: vi.fn().mockResolvedValue({ id: 100 }),
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

describe('SignalHandle construction', () => {
  it('stores indicator handles, comparison, and tolerance', () => {
    const storage = mockStorage();
    const market = mockMarket();
    const ticker = new TickerHandle(storage, 'SPY');
    const ind1 = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = new IndicatorHandle(storage, market, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const handle = new SignalHandle(storage, market, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 5,
    });

    expect(handle.indicator1).toBe(ind1);
    expect(handle.indicator2).toBe(ind2);
    expect(handle.comparison).toBe('>');
    expect(handle.tolerance).toBe(5);
  });

  it('stores zero tolerance', () => {
    const storage = mockStorage();
    const market = mockMarket();
    const ind1 = new IndicatorHandle(storage, market, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = new IndicatorHandle(storage, market, {
      type: 'Threshold',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: 20,
    });
    const handle = new SignalHandle(storage, market, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '<',
      tolerance: 0,
    });
    expect(handle.tolerance).toBe(0);
  });

  it('throws on .id before resolution', () => {
    const storage = mockStorage();
    const market = mockMarket();
    const ind1 = new IndicatorHandle(storage, market, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = new IndicatorHandle(storage, market, {
      type: 'Threshold',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: 20,
    });
    const handle = new SignalHandle(storage, market, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 0,
    });
    expect(() => handle.id).toThrow('not yet resolved');
  });
});

describe('SignalHandle.resolve', () => {
  it('resolves both indicators then upserts signal', async () => {
    const storage = mockStorage({
      indicators: {
        upsert: vi.fn().mockResolvedValueOnce({ id: 10 }).mockResolvedValueOnce({ id: 11 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
      signals: {
        upsert: vi.fn().mockResolvedValue({ id: 100 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getLastValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket();

    const ticker = new TickerHandle(storage, 'SPY');
    const ind1 = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = new IndicatorHandle(storage, market, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const handle = new SignalHandle(storage, market, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 5,
    });

    const result = await handle.resolve();

    expect(result).toEqual({ id: 100 });
    expect(handle.id).toBe(100);
    expect(storage.signals.upsert).toHaveBeenCalledWith({
      indicatorId1: 10,
      indicatorId2: 11,
      comparison: '>',
      tolerance: 5,
    });
  });

  it('caches resolution', async () => {
    const storage = mockStorage();
    const market = mockMarket();

    const ind1 = IndicatorHandle.fromResolved(storage, market, 10, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = IndicatorHandle.fromResolved(storage, market, 11, {
      type: 'Threshold',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: 20,
    });
    const handle = new SignalHandle(storage, market, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 0,
    });

    await handle.resolve();
    await handle.resolve();

    expect(storage.signals.upsert).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const storage = mockStorage();
    const market = mockMarket();

    const ind1 = IndicatorHandle.fromResolved(storage, market, 10, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = IndicatorHandle.fromResolved(storage, market, 11, {
      type: 'Threshold',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: 20,
    });
    const handle = new SignalHandle(storage, market, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 0,
    });

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);
    expect(r1).toEqual(r2);
    expect(storage.signals.upsert).toHaveBeenCalledTimes(1);
  });
});
