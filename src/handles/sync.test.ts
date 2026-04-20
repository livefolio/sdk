import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndicatorHandle } from './indicator';
import { TickerHandle } from './ticker';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

// ── Mock providers ───────────────────────────────────────────────────

const RATE_TICKER_SYMBOLS = new Set(['DTB3', 'DFF', 'DGS1', 'DGS2', 'DGS5', 'DGS10', 'DGS20', 'DGS30']);

vi.mock('../providers/mappings.js', () => ({
  getProviderInfo: vi.fn().mockImplementation((type: string, symbol: string | null) => {
    if (type === 'Price') return { provider: 'yahoo', symbol: symbol! };
    if (type === 'T10Y') return { provider: 'fred', seriesId: 'DGS10' };
    if (type === 'Threshold') return { provider: 'none' };
    return { provider: 'none' };
  }),
  isRateTickerSymbol: vi.fn().mockImplementation((symbol: string | null) => {
    return symbol != null && RATE_TICKER_SYMBOLS.has(symbol);
  }),
}));

vi.mock('../computations/index.js', () => ({
  getComputation: vi.fn().mockReturnValue(null),
}));

vi.mock('../computations/calendar.js', () => ({
  computeCalendar: vi.fn().mockReturnValue([]),
}));

// ── Helpers ──────────────────────────────────────────────────────────

const LATEST_CLOSED_DATE = '2026-03-28';

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
      getLatestClosed: vi.fn().mockResolvedValue(LATEST_CLOSED_DATE),
    },
    ...overrides,
  } as StorageProvider;
}

function mockMarket(overrides?: Partial<MarketProvider>): MarketProvider {
  return {
    fetchBars: vi.fn().mockResolvedValue([
      { date: '2026-03-27', value: 100 },
      { date: '2026-03-28', value: 101 },
    ]),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('IndicatorHandle sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches from market provider when Price series is empty', async () => {
    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([
          { date: '2026-03-27', value: 100 },
          { date: '2026-03-28', value: 101 },
        ]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null), // no existing data
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket();
    const ticker = new TickerHandle(storage, 'SPY');

    const handle = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const bars = await handle.series();

    expect(market.fetchBars).toHaveBeenCalledWith('SPY', undefined);
    expect(storage.indicators.writeSeries).toHaveBeenCalled();
    expect(bars).toHaveLength(2);
    expect(bars[0].date).toBe('2026-03-27');
  });

  it('applies leverage multiplier to daily returns when ticker has leverage != 1', async () => {
    const writtenBars: { date: string; value: number }[][] = [];
    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockImplementation((_id: number, bars: { date: string; value: number }[]) => {
          writtenBars.push(bars);
          return Promise.resolve();
        }),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket({
      fetchBars: vi.fn().mockResolvedValue([
        { date: '2026-03-27', value: 100 },
        { date: '2026-03-28', value: 102 },
      ]),
    });
    const ticker = new TickerHandle(storage, 'SPY', 2);

    const handle = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.series();

    expect(writtenBars).toHaveLength(1);
    const values = writtenBars[0].map((b) => b.value);
    // First bar unchanged
    expect(values[0]).toBeCloseTo(100, 5);
    // Second bar: 100 * (1 + 2 * 0.02) = 104
    expect(values[1]).toBeCloseTo(104, 5);
  });

  it('anchors leverage to last stored value on incremental sync', async () => {
    const writtenBars: { date: string; value: number }[][] = [];
    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockImplementation((_id: number, bars: { date: string; value: number }[]) => {
          writtenBars.push(bars);
          return Promise.resolve();
        }),
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-03-27'), // incremental
        getValue: vi.fn().mockResolvedValue(200), // last stored leveraged price
      },
    });
    const market = mockMarket({
      fetchBars: vi.fn().mockResolvedValue([
        { date: '2026-03-27', value: 100 }, // raw Yahoo price at fromDate
        { date: '2026-03-28', value: 102 }, // +2% raw return
      ]),
    });
    const ticker = new TickerHandle(storage, 'SPY', 2);

    const handle = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.series();

    expect(writtenBars).toHaveLength(1);
    const values = writtenBars[0].map((b) => b.value);
    // First bar should be the stored leveraged value (200), NOT the raw price (100)
    expect(values[0]).toBeCloseTo(200, 5);
    // Second bar: 200 * (1 + 2 * 0.02) = 208
    expect(values[1]).toBeCloseTo(208, 5);
  });

  it('does not apply leverage when leverage is 1', async () => {
    const writtenBars: { date: string; value: number }[][] = [];
    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockImplementation((_id: number, bars: { date: string; value: number }[]) => {
          writtenBars.push(bars);
          return Promise.resolve();
        }),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket({
      fetchBars: vi.fn().mockResolvedValue([
        { date: '2026-03-27', value: 100 },
        { date: '2026-03-28', value: 102 },
      ]),
    });
    const ticker = new TickerHandle(storage, 'SPY', 1);

    const handle = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.series();

    expect(writtenBars).toHaveLength(1);
    const values = writtenBars[0].map((b) => b.value);
    expect(values[0]).toBeCloseTo(100, 5);
    expect(values[1]).toBeCloseTo(102, 5);
  });

  it('fetches from market provider for treasury indicators', async () => {
    const mappings = await import('../providers/mappings.js');
    const getProviderInfoMock = mappings.getProviderInfo as unknown as ReturnType<typeof vi.fn>;
    getProviderInfoMock.mockReturnValue({ provider: 'fred', seriesId: 'DGS10' });

    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([
          { date: '2026-03-27', value: 4.25 },
          { date: '2026-03-28', value: 4.3 },
        ]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket({
      fetchBars: vi.fn().mockResolvedValue([
        { date: '2026-03-27', value: 4.25 },
        { date: '2026-03-28', value: 4.3 },
      ]),
    });

    const handle = new IndicatorHandle(storage, market, {
      type: 'T10Y',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const bars = await handle.series();

    expect(market.fetchBars).toHaveBeenCalledWith('DGS10', undefined);
    expect(storage.indicators.writeSeries).toHaveBeenCalled();
    expect(bars).toHaveLength(2);
  });

  it('skips sync when series is already fresh', async () => {
    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([
          { date: '2026-03-27', value: 100 },
          { date: '2026-03-28', value: 101 },
        ]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(LATEST_CLOSED_DATE), // already up to date
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket();
    const ticker = new TickerHandle(storage, 'SPY');

    const handle = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.series();

    // Should NOT have called fetchBars since DB is already fresh
    expect(market.fetchBars).not.toHaveBeenCalled();
    expect(storage.indicators.writeSeries).not.toHaveBeenCalled();
  });

  it('caches series in memory on subsequent calls', async () => {
    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        getSeries: vi.fn().mockResolvedValue([
          { date: '2026-03-27', value: 100 },
          { date: '2026-03-28', value: 101 },
        ]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(LATEST_CLOSED_DATE),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket();
    const ticker = new TickerHandle(storage, 'SPY');

    const handle = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const bars1 = await handle.series();
    const bars2 = await handle.series();

    // Should be the exact same reference (cached)
    expect(bars1).toBe(bars2);
  });

  it('does not apply leverage compounding to rate-ticker Price series', async () => {
    const writtenBars: { date: string; value: number }[][] = [];
    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 20 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockImplementation((_id: number, bars: { date: string; value: number }[]) => {
          writtenBars.push(bars);
          return Promise.resolve();
        }),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket({
      fetchBars: vi.fn().mockResolvedValue([
        { date: '2026-03-27', value: 5.25 },
        { date: '2026-03-28', value: 5.3 },
      ]),
    });
    const ticker = new TickerHandle(storage, 'DTB3', 2);

    const handle = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.series();

    expect(writtenBars).toHaveLength(1);
    const values = writtenBars[0]!.map((b) => b.value);
    // Values preserved verbatim — no leverage compounding for rate tickers.
    expect(values[0]).toBeCloseTo(5.25, 5);
    expect(values[1]).toBeCloseTo(5.3, 5);
  });
});
