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

describe('IndicatorHandle.computeAt — leverage anchor for computed indicators', () => {
  it('compounds from stored leveraged anchor, not raw value, for SMA with leverage', async () => {
    // Setup:
    //   leverage = 3, lookback = 2 (SMA-2)
    //   Raw prices stored under the lev=1 Price indicator (id=20): 100, 100 up to yesterday
    //   Stored leveraged Price series (id=10) anchor for '2026-04-15' = 300
    //   Today's raw override via computeAt arg: 102
    //   Leveraged bars after _applyLeverage:
    //     04-15: 300 (anchor)
    //     04-16: rawReturn=0 → 300
    //     04-17: rawReturn=0.02 → 300*(1+3*0.02)=318
    //   SMA-2 of [300, 318] = 309
    const storedLeveraged: Record<string, number> = {
      '2026-04-14': 300,
      '2026-04-15': 300,
      '2026-04-16': 300,
    };

    const storedRawBars = [
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 100 },
    ];

    const storage = mockStorage({
      tickers: {
        // lev=3 ticker → id 1 (used by the SMA's ticker), lev=1 ticker → id 2 (used by the raw Price lookup)
        findOrCreate: vi.fn().mockImplementation(async (_sym: string, lev: number) => ({ id: lev === 1 ? 2 : 1 })),
      },
      indicators: {
        findOrCreate: vi.fn().mockImplementation(async (identity: { type: string; tickerId: number | null }) => {
          // Raw Price SPY (tickerId = 2) → id 20; everything else → id 10
          if (identity.type === 'Price' && identity.tickerId === 2) return { id: 20 };
          return { id: 10 };
        }),
        getSeries: vi.fn().mockImplementation(async (indicatorId: number) => {
          if (indicatorId === 20) return storedRawBars;
          return [];
        }),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-16'),
        getValue: vi.fn().mockImplementation(async (_id: number, date?: string) => {
          // Anchor lookup for _applyLeverage — returns the stored leveraged value.
          if (!date) return storedLeveraged['2026-04-16'] ?? null;
          return storedLeveraged[date] ?? null;
        }),
      },
      tradingDays: {
        getRange: vi.fn().mockResolvedValue([]),
        // latestClosed = yesterday means date=today (04-17) skips the market fetch — pure storage path.
        getLatestClosed: vi.fn().mockResolvedValue('2026-04-16'),
      },
    });

    const market = mockMarket();
    const ticker = TickerHandle.fromResolved(storage, 1, 'SPY', 3);
    const handle = IndicatorHandle.fromResolved(storage, market, 10, {
      type: 'SMA',
      ticker,
      lookback: 2,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const result = await handle.computeAt('2026-04-17', { SPY: 102 });

    expect(result).toBeCloseTo(309, 5);
  });

  it('uses stored leveraged anchor, not raw value, for Price indicator with leverage', async () => {
    // leverage=3, yesterday raw=100, yesterday leveraged=300
    // today raw override=110 → rawReturn=0.10 → leveraged today = 300*(1+3*0.10)=390
    const storedLeveraged: Record<string, number> = { '2026-04-16': 300 };
    const storedRawBars = [{ date: '2026-04-16', value: 100 }];

    const storage = mockStorage({
      tickers: {
        findOrCreate: vi.fn().mockImplementation(async (_sym: string, lev: number) => ({ id: lev === 1 ? 2 : 1 })),
      },
      indicators: {
        findOrCreate: vi.fn().mockImplementation(async (identity: { type: string; tickerId: number | null }) => {
          if (identity.type === 'Price' && identity.tickerId === 2) return { id: 20 };
          return { id: 10 };
        }),
        getSeries: vi.fn().mockImplementation(async (indicatorId: number) => {
          if (indicatorId === 20) return storedRawBars;
          return [];
        }),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-16'),
        getValue: vi.fn().mockImplementation(async (_id: number, date?: string) => {
          if (!date) return storedLeveraged['2026-04-16'] ?? null;
          return storedLeveraged[date] ?? null;
        }),
      },
      tradingDays: {
        getRange: vi.fn().mockResolvedValue([]),
        getLatestClosed: vi.fn().mockResolvedValue('2026-04-16'),
      },
    });

    const market = mockMarket();
    const ticker = TickerHandle.fromResolved(storage, 1, 'SPY', 3);
    const handle = IndicatorHandle.fromResolved(storage, market, 10, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const result = await handle.computeAt('2026-04-17', { SPY: 110 });
    expect(result).toBeCloseTo(390, 5);
  });
});

describe('IndicatorHandle.computeAt — bounded bar fetch from market (closed-day path)', () => {
  it('calls fetchBars with a bounded `from` for a computed indicator with large lookback', async () => {
    const fetchBarsSpy = vi.fn().mockResolvedValue([
      { date: '2026-04-15', value: 100 },
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
      tradingDays: {
        getRange: vi.fn().mockResolvedValue([]),
        // Market has closed for `date` → _resolveRawBars prefers market first.
        getLatestClosed: vi.fn().mockResolvedValue('2026-04-17'),
      },
    });

    const market: MarketProvider = { fetchBars: fetchBarsSpy };
    const ticker = TickerHandle.fromResolved(storage, 1, 'SPY', 1);
    const handle = IndicatorHandle.fromResolved(storage, market, 10, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.computeAt('2026-04-17');

    expect(fetchBarsSpy).toHaveBeenCalled();
    const callArgs = fetchBarsSpy.mock.calls[0] as [string, string | undefined];
    expect(callArgs[1]).toBeDefined();
    expect(callArgs[1]! < '2026-04-17').toBe(true);
  });

  it('calls fetchBars with a bounded `from` for a fetched (yahoo/fred) indicator', async () => {
    const fetchBarsSpy = vi.fn().mockResolvedValue([
      { date: '2026-04-16', value: 20 },
      { date: '2026-04-17', value: 21 },
    ]);

    const storage = mockStorage({
      tradingDays: {
        getRange: vi.fn().mockResolvedValue([]),
        getLatestClosed: vi.fn().mockResolvedValue('2026-04-17'),
      },
    });
    const market: MarketProvider = { fetchBars: fetchBarsSpy };
    const handle = IndicatorHandle.fromResolved(storage, market, 10, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.computeAt('2026-04-17');

    expect(fetchBarsSpy).toHaveBeenCalled();
    const callArgs = fetchBarsSpy.mock.calls[0] as [string, string | undefined];
    expect(callArgs[1]).toBeDefined();
    expect(callArgs[1]! < '2026-04-17').toBe(true);
  });
});

// ─── IndicatorHandle.previewSeries tests ──────────────────────────────────────

describe('IndicatorHandle.previewSeries', () => {
  const tradingDays = ['2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'];
  const yesterday = '2026-04-16';
  const today = '2026-04-17';

  it('appends today in-memory bar to stored historical series', async () => {
    const historical = [
      { date: '2026-04-14', value: 100 },
      { date: '2026-04-15', value: 101 },
      { date: yesterday, value: 102 },
    ];
    const writeSpy = vi.fn();
    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue(historical),
        writeSeries: writeSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue(yesterday),
        getValue: vi.fn().mockImplementation(async (_id: number, d?: string) => {
          if (!d) return 102;
          return historical.find((b) => b.date === d)?.value ?? null;
        }),
      },
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(tradingDays),
        getLatestClosed: vi.fn().mockResolvedValue(yesterday),
      },
    });

    const baseMarket = mockMarket({
      fetchBars: vi.fn().mockResolvedValue([{ date: yesterday, value: 102 }]),
    });

    const ticker = TickerHandle.fromResolved(storage, 1, 'SPY', 1);
    const handle = IndicatorHandle.fromResolved(storage, baseMarket, 10, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const bars = await handle.previewSeries(today, { SPY: 110 });

    expect(bars).toHaveLength(4);
    expect(bars[3]).toEqual({ date: today, value: 110 });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('overwrites existing stored bar when date is already in storage', async () => {
    const historical = [
      { date: '2026-04-14', value: 100 },
      { date: '2026-04-15', value: 101 },
      { date: yesterday, value: 102 },
      { date: today, value: 103 },
    ];
    const writeSpy = vi.fn();
    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue(historical),
        writeSeries: writeSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue(today),
        getValue: vi.fn().mockImplementation(async (_id: number, d?: string) => {
          return historical.find((b) => b.date === d)?.value ?? null;
        }),
      },
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(tradingDays),
        getLatestClosed: vi.fn().mockResolvedValue(today),
      },
    });

    const baseMarket = mockMarket({
      fetchBars: vi.fn().mockResolvedValue([
        { date: yesterday, value: 102 },
        { date: today, value: 103 },
      ]),
    });

    const ticker = TickerHandle.fromResolved(storage, 1, 'SPY', 1);
    const handle = IndicatorHandle.fromResolved(storage, baseMarket, 10, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const bars = await handle.previewSeries(today, { SPY: 120 });

    expect(bars).toHaveLength(4);
    expect(bars[3]).toEqual({ date: today, value: 120 });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('throws when date is not a trading day', async () => {
    const storage = mockStorage({
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(tradingDays),
        getLatestClosed: vi.fn().mockResolvedValue(yesterday),
      },
    });

    const handle = IndicatorHandle.fromResolved(storage, mockMarket(), 10, {
      type: 'Price',
      ticker: TickerHandle.fromResolved(storage, 1, 'SPY', 1),
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await expect(handle.previewSeries('2026-04-18', {})).rejects.toThrow('not a trading day');
  });
});
