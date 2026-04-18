import { describe, it, expect, vi } from 'vitest';
import { IndicatorHandle } from './indicator';
import { TickerHandle } from './ticker';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

function mockStorage(overrides?: Partial<StorageProvider>): StorageProvider {
  return {
    tickers: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
    },
    indicators: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
      getSeries: vi.fn().mockResolvedValue([]),
      writeSeries: vi.fn().mockResolvedValue(undefined),
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getValue: vi.fn().mockResolvedValue(null),
    },
    signals: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
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
      getLatestAllocationId: vi.fn().mockResolvedValue(null),
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
      tickers: { findOrCreate: vi.fn().mockResolvedValue({ id: 1 }) },
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
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
    expect(storage.tickers.findOrCreate).toHaveBeenCalledWith('SPY', 1);
    expect(storage.indicators.findOrCreate).toHaveBeenCalledWith({
      type: 'SMA',
      tickerId: 1,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });
  });

  it('resolves standalone indicator without ticker', async () => {
    const findOrCreate = vi.fn().mockResolvedValue({ id: 20 });
    const storage = mockStorage({
      indicators: {
        findOrCreate,
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
    expect(findOrCreate).toHaveBeenCalledWith({
      type: 'VIX',
      tickerId: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
  });

  it('caches resolution', async () => {
    const findOrCreate = vi.fn().mockResolvedValue({ id: 20 });
    const storage = mockStorage({
      indicators: {
        findOrCreate,
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
    expect(findOrCreate).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const findOrCreate = vi.fn().mockResolvedValue({ id: 20 });
    const storage = mockStorage({
      indicators: {
        findOrCreate,
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
    expect(findOrCreate).toHaveBeenCalledTimes(1);
  });
});

// ─── IndicatorHandle.computeAt tests ──────────────────────────────────────────

describe('IndicatorHandle.computeAt — Issue 1: leverage anchor for computed indicators', () => {
  it('compounds from stored leveraged anchor, not raw value, for SMA with leverage', async () => {
    // Setup:
    //   leverage = 3, lookback = 2 (SMA-2)
    //   Raw price history: 100, 100, 100, 102  (last is today's overlay bar)
    //   Stored leveraged Price series up to yesterday (2026-04-16):
    //     anchor at first bar (2026-04-14): 300 (i.e. raw 100 × leverage = 300)
    //     2026-04-15: 300 (raw stayed flat)
    //     2026-04-16: 300 (raw stayed flat)
    //   Today raw = 102 → rawReturn = (102-100)/100 = 0.02
    //   Leveraged today = 300 * (1 + 3 * 0.02) = 318
    //   SMA-2 of [300, 318] = 309

    const storedLeveraged: Record<string, number> = {
      '2026-04-14': 300,
      '2026-04-15': 300,
      '2026-04-16': 300,
    };

    // The overlay market returns raw bars for the fetch window
    // computeAt will call fetchBars(symbol, from) where from < 2026-04-16
    const rawBarsInWindow = [
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 100 },
      { date: '2026-04-17', value: 102 }, // today's override
    ];

    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-16'),
        getValue: vi.fn().mockImplementation(async (_id: number, date?: string) => {
          if (!date) return storedLeveraged['2026-04-16'] ?? null;
          return storedLeveraged[date] ?? null;
        }),
      },
    });

    const overlayMarket = mockMarket({
      fetchBars: vi.fn().mockResolvedValue(rawBarsInWindow),
    });

    const ticker = TickerHandle.fromResolved(storage, 1, 'SPY', 3);
    const handle = IndicatorHandle.fromResolved(storage, overlayMarket, 10, {
      type: 'SMA',
      ticker,
      lookback: 2,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const result = await handle.computeAt(overlayMarket, '2026-04-17');

    // Leveraged bars in window:
    //   2026-04-15: anchor from storage = 300, leveraged[0] = 300
    //   2026-04-16: rawReturn=(100-100)/100=0, leveraged[1] = 300*(1+3*0) = 300
    //   2026-04-17: rawReturn=(102-100)/100=0.02, leveraged[2] = 300*(1+3*0.02) = 318
    // SMA-2 of last 2 = (300 + 318) / 2 = 309
    expect(result).toBeCloseTo(309, 5);
  });

  it('uses stored leveraged anchor, not raw value, for Price indicator with leverage', async () => {
    // leverage = 3, yesterday raw = 100, yesterday leveraged = 300
    // today raw = 110 → rawReturn = 0.10 → leveraged today = 300 * (1 + 3*0.10) = 390
    const storedLeveraged: Record<string, number> = {
      '2026-04-16': 300,
    };

    const rawBarsInWindow = [
      { date: '2026-04-16', value: 100 },
      { date: '2026-04-17', value: 110 },
    ];

    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-16'),
        getValue: vi.fn().mockImplementation(async (_id: number, date?: string) => {
          if (!date) return storedLeveraged['2026-04-16'] ?? null;
          return storedLeveraged[date] ?? null;
        }),
      },
    });

    const overlayMarket = mockMarket({
      fetchBars: vi.fn().mockResolvedValue(rawBarsInWindow),
    });

    const ticker = TickerHandle.fromResolved(storage, 1, 'SPY', 3);
    const handle = IndicatorHandle.fromResolved(storage, overlayMarket, 10, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const result = await handle.computeAt(overlayMarket, '2026-04-17');
    // leveragedPrev = 300, rawReturn = (110-100)/100 = 0.10, leverage = 3
    // result = 300 * (1 + 3 * 0.10) = 390
    expect(result).toBeCloseTo(390, 5);
  });
});

describe('IndicatorHandle.computeAt — Issue 2: bounded bar fetch', () => {
  it('calls fetchBars with a non-undefined from for a computed indicator with large lookback', async () => {
    const fetchBarsSpy = vi.fn().mockResolvedValue([
      { date: '2026-04-16', value: 100 },
      { date: '2026-04-17', value: 100 },
    ]);

    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });

    const overlayMarket: MarketProvider = { fetchBars: fetchBarsSpy };

    const ticker = TickerHandle.fromResolved(storage, 1, 'SPY', 1);
    const handle = IndicatorHandle.fromResolved(storage, overlayMarket, 10, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.computeAt(overlayMarket, '2026-04-17');

    expect(fetchBarsSpy).toHaveBeenCalled();
    const callArgs = fetchBarsSpy.mock.calls[0] as [string, string | undefined];
    expect(callArgs[1]).toBeDefined();
    expect(callArgs[1]).not.toBeUndefined();
    // The from date should be well before the target date to cover the 200-bar lookback
    expect(callArgs[1]! < '2026-04-17').toBe(true);
  });

  it('calls fetchBars with a non-undefined from for a fetched (yahoo/fred) indicator', async () => {
    const fetchBarsSpy = vi.fn().mockResolvedValue([
      { date: '2026-04-16', value: 20 },
      { date: '2026-04-17', value: 21 },
    ]);

    const storage = mockStorage();
    const overlayMarket: MarketProvider = { fetchBars: fetchBarsSpy };

    const handle = IndicatorHandle.fromResolved(storage, overlayMarket, 10, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.computeAt(overlayMarket, '2026-04-17');

    expect(fetchBarsSpy).toHaveBeenCalled();
    const callArgs = fetchBarsSpy.mock.calls[0] as [string, string | undefined];
    expect(callArgs[1]).toBeDefined();
    expect(callArgs[1]! < '2026-04-17').toBe(true);
  });
});
