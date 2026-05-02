import { describe, it, expect, vi } from 'vitest';
import { TickerHandle } from './ticker';
import { IndicatorHandle } from './indicator';
import { SignalHandle } from './signal';
import { AllocationHandle } from './allocation';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

function mockStorage(): StorageProvider {
  return {
    tickers: { findOrCreate: vi.fn().mockResolvedValue({ id: 1 }) },
    indicators: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
      getSeries: vi.fn().mockResolvedValue([]),
      writeSeries: vi.fn().mockResolvedValue(undefined),
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getValue: vi.fn().mockResolvedValue(null),
      getLatestBar: vi.fn().mockResolvedValue(null),
    },
    signals: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
      getSeries: vi.fn().mockResolvedValue([]),
      writeSeries: vi.fn().mockResolvedValue(undefined),
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getLastValue: vi.fn().mockResolvedValue(null),
    },
    allocations: { findOrCreate: vi.fn().mockResolvedValue({ id: 1 }) },
    strategies: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      getSeries: vi.fn().mockResolvedValue([]),
      writeSeries: vi.fn().mockResolvedValue(undefined),
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getLatestAllocationId: vi.fn().mockResolvedValue(null),
      resolveReference: vi.fn().mockResolvedValue({}),
    },
    tradingDays: {
      getRange: vi.fn().mockResolvedValue([]),
      getLatestClosed: vi.fn().mockResolvedValue(null),
    },
  } as StorageProvider;
}

function mockMarket(): MarketProvider {
  return { fetchBars: vi.fn().mockResolvedValue([]) };
}

describe('TickerHandle.fromResolved', () => {
  it('creates a pre-resolved handle', () => {
    const storage = mockStorage();
    const handle = TickerHandle.fromResolved(storage, 1, 'SPY', 1);
    expect(handle.symbol).toBe('SPY');
    expect(handle.leverage).toBe(1);
    expect(handle.id).toBe(1);
  });

  it('resolve() returns cached id without DB call', async () => {
    const storage = mockStorage();
    const handle = TickerHandle.fromResolved(storage, 1, 'SPY', 1);
    const result = await handle.resolve();
    expect(result).toEqual({ id: 1 });
    expect(storage.tickers.findOrCreate).not.toHaveBeenCalled();
  });
});

describe('IndicatorHandle.fromResolved', () => {
  it('creates a pre-resolved handle with ticker', () => {
    const storage = mockStorage();
    const market = mockMarket();
    const ticker = TickerHandle.fromResolved(storage, 1, 'SPY', 1);
    const handle = IndicatorHandle.fromResolved(storage, market, 10, {
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
    expect(handle.id).toBe(10);
  });

  it('creates a pre-resolved handle without ticker', () => {
    const storage = mockStorage();
    const market = mockMarket();
    const handle = IndicatorHandle.fromResolved(storage, market, 20, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    expect(handle.type).toBe('VIX');
    expect(handle.ticker).toBeNull();
    expect(handle.id).toBe(20);
  });
});

describe('SignalHandle.fromResolved', () => {
  it('creates a pre-resolved handle', () => {
    const storage = mockStorage();
    const market = mockMarket();
    const ind1 = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = new IndicatorHandle(storage, market, {
      type: 'SMA',
      ticker: null,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const handle = SignalHandle.fromResolved(storage, market, 100, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 5,
    });
    expect(handle.comparison).toBe('>');
    expect(handle.tolerance).toBe(5);
    expect(handle.indicator1).toBe(ind1);
    expect(handle.indicator2).toBe(ind2);
    expect(handle.id).toBe(100);
  });
});

describe('AllocationHandle.fromResolved', () => {
  it('creates a pre-resolved handle from holdings', () => {
    const storage = mockStorage();
    const spy = TickerHandle.fromResolved(storage, 1, 'SPY', 1);
    const gld = TickerHandle.fromResolved(storage, 2, 'GLD', 1);
    const handle = AllocationHandle.fromResolved(storage, 50, [
      [spy, 0.6],
      [gld, 0.4],
    ]);
    expect(handle.id).toBe(50);
    expect(handle.holdings).toHaveLength(2);
  });

  it('preserves leverage on tickers', () => {
    const storage = mockStorage();
    const spxl = TickerHandle.fromResolved(storage, 1, 'SPXL', 3);
    const handle = AllocationHandle.fromResolved(storage, 51, [[spxl, 1.0]]);
    expect(handle.holdings[0][0].symbol).toBe('SPXL');
    expect(handle.holdings[0][0].leverage).toBe(3);
  });

  it('resolve() returns cached id without DB call', async () => {
    const storage = mockStorage();
    const spy = TickerHandle.fromResolved(storage, 1, 'SPY', 1);
    const handle = AllocationHandle.fromResolved(storage, 50, [[spy, 1.0]]);
    const result = await handle.resolve();
    expect(result).toEqual({ id: 50 });
    expect(storage.allocations.findOrCreate).not.toHaveBeenCalled();
  });
});
