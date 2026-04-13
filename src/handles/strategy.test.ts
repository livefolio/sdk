import { describe, it, expect, vi } from 'vitest';
import { StrategyHandle } from './strategy';
import type { StrategyBar } from './strategy';
import { SignalHandle } from './signal';
import { AllocationHandle } from './allocation';
import { IndicatorHandle } from './indicator';
import { TickerHandle } from './ticker';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';
import type { DailyBar } from './indicator';
import type { StrategyReferenceData } from '../providers/types';

const storage = {} as StorageProvider;
const market = {} as MarketProvider;

function makeSignal() {
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
    threshold: 30,
  });
  return new SignalHandle(storage, market, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 0 });
}

function makeAllocation() {
  return new AllocationHandle(storage, [[new TickerHandle(storage, 'SPY'), 1.0]]);
}

describe('StrategyHandle construction - create mode', () => {
  it('stores options with defaults', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(storage, market, { name: 'Test', rules: [{ hold: alloc }] });
    expect(handle.name).toBe('Test');
    expect(handle.freq).toBe('Daily');
    expect(handle.offset).toBe(0);
    expect(handle.rules).toHaveLength(1);
  });

  it('stores explicit freq and offset', () => {
    const signal = makeSignal();
    const alloc1 = makeAllocation();
    const alloc2 = makeAllocation();
    const handle = new StrategyHandle(storage, market, {
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
    expect(() => new StrategyHandle(storage, market, { name: 'Empty', rules: [] })).toThrow('at least one rule');
  });

  it('throws if last rule has a when clause', () => {
    const signal = makeSignal();
    const alloc = makeAllocation();
    expect(
      () => new StrategyHandle(storage, market, { name: 'Bad', rules: [{ when: [signal], hold: alloc }] }),
    ).toThrow('fallback');
  });

  it('throws if a non-last rule has an empty when array', () => {
    const alloc1 = makeAllocation();
    const alloc2 = makeAllocation();
    expect(
      () => new StrategyHandle(storage, market, { name: 'Bad', rules: [{ when: [], hold: alloc1 }, { hold: alloc2 }] }),
    ).toThrow('unreachable');
  });

  it('throws on .id before resolution', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(storage, market, { name: 'Test', rules: [{ hold: alloc }] });
    expect(() => handle.id).toThrow('not yet resolved');
  });

  it('throws on .link before resolution', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(storage, market, { name: 'Test', rules: [{ hold: alloc }] });
    expect(() => handle.link).toThrow('not yet resolved');
  });
});

describe('StrategyHandle construction - reference mode', () => {
  it('stores linkId with defaults', () => {
    const handle = new StrategyHandle(storage, market, 'abc123');
    expect(handle.name).toBeNull();
    expect(handle.freq).toBe('Daily');
    expect(handle.offset).toBe(0);
    expect(handle.rules).toHaveLength(0);
  });
});

describe('StrategyHandle.resolve - create mode', () => {
  it('resolves dependencies, generates link_id, and inserts strategy', async () => {
    const mockStorage: StorageProvider = {
      tickers: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
      },
      indicators: {
        findOrCreate: vi.fn().mockResolvedValueOnce({ id: 10 }).mockResolvedValueOnce({ id: 11 }),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        getValue: vi.fn(),
      },
      signals: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 100 }),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        getLastValue: vi.fn(),
      },
      allocations: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 50 }),
      },
      strategies: {
        create: vi.fn().mockResolvedValue({ id: 200 }),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        resolveReference: vi.fn(),
      },
      tradingDays: {
        getRange: vi.fn(),
        getLatestClosed: vi.fn(),
      },
    };
    const mockMarket: MarketProvider = {
      fetchBars: vi.fn(),
    };

    const signal = new SignalHandle(mockStorage, mockMarket, {
      indicator1: new IndicatorHandle(mockStorage, mockMarket, {
        type: 'VIX',
        ticker: null,
        lookback: 0,
        delay: 0,
        unit: null,
        threshold: null,
      }),
      indicator2: new IndicatorHandle(mockStorage, mockMarket, {
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
    const alloc1 = new AllocationHandle(mockStorage, [[new TickerHandle(mockStorage, 'SPY'), 1.0]]);
    const alloc2 = new AllocationHandle(mockStorage, [[new TickerHandle(mockStorage, 'SPY'), 1.0]]);

    const handle = new StrategyHandle(mockStorage, mockMarket, {
      name: 'Test',
      rules: [{ when: [signal], hold: alloc1 }, { hold: alloc2 }],
    });

    const result = await handle.resolve();

    expect(result.id).toBe(200);
    expect(handle.id).toBe(200);
    expect(handle.link).toBeDefined();
    expect(mockStorage.strategies.create).toHaveBeenCalled();
    const createArg = (mockStorage.strategies.create as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      name: string;
      linkId: string;
      rules: { signalIds: number[]; allocationId: number }[];
    };
    expect(createArg.name).toBe('Test');
    expect(createArg.linkId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(createArg.rules).toHaveLength(2);
    expect(createArg.rules[0].signalIds).toEqual([100]);
    expect(createArg.rules[0].allocationId).toBe(50);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const createMock = vi.fn().mockResolvedValue({ id: 200 });
    const mockStorage: StorageProvider = {
      tickers: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
      },
      indicators: {
        findOrCreate: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        getValue: vi.fn(),
      },
      signals: {
        findOrCreate: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        getLastValue: vi.fn(),
      },
      allocations: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 50 }),
      },
      strategies: {
        create: createMock,
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        resolveReference: vi.fn(),
      },
      tradingDays: {
        getRange: vi.fn(),
        getLatestClosed: vi.fn(),
      },
    };
    const mockMarket: MarketProvider = {
      fetchBars: vi.fn(),
    };

    const alloc = new AllocationHandle(mockStorage, [[new TickerHandle(mockStorage, 'SPY'), 1.0]]);
    const handle = new StrategyHandle(mockStorage, mockMarket, { name: 'Test', rules: [{ hold: alloc }] });

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);
    expect(r1).toEqual(r2);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe('StrategyHandle.resolve - reference mode', () => {
  it('fetches strategy by link_id and reconstructs rules', async () => {
    const refData: StrategyReferenceData = {
      id: 200,
      name: 'Tactical',
      freq: 'Monthly',
      offset: 2,
      rules: {
        signals: [{ id: 100, indicatorId1: 10, indicatorId2: 11, comparison: '>', tolerance: 5 }],
        allocations: [
          { id: 50, holdings: { SPY: 1.0 } },
          { id: 51, holdings: { SHY: 1.0 } },
        ],
        indicators: [
          { id: 10, type: 'Price', tickerId: 1, lookback: 0, delay: 0, unit: null, threshold: null },
          { id: 11, type: 'SMA', tickerId: 1, lookback: 200, delay: 0, unit: null, threshold: null },
        ],
        tickers: [{ id: 1, symbol: 'SPY', leverage: 1 }],
        definition: [{ signalIds: [100], allocationId: 50 }, { allocationId: 51 }],
      },
    };

    const mockStorage: StorageProvider = {
      tickers: { findOrCreate: vi.fn() },
      indicators: {
        findOrCreate: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        getValue: vi.fn(),
      },
      signals: {
        findOrCreate: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        getLastValue: vi.fn(),
      },
      allocations: { findOrCreate: vi.fn() },
      strategies: {
        create: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        resolveReference: vi.fn().mockResolvedValue(refData),
      },
      tradingDays: {
        getRange: vi.fn(),
        getLatestClosed: vi.fn(),
      },
    };
    const mockMarket: MarketProvider = { fetchBars: vi.fn() };

    const handle = new StrategyHandle(mockStorage, mockMarket, 'abc123');
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

  it('allocation tickers resolve lazily via findOrCreate (not pre-resolved with id=0)', async () => {
    const refData: StrategyReferenceData = {
      id: 200,
      name: 'Tactical',
      freq: 'Monthly',
      offset: 2,
      rules: {
        signals: [],
        allocations: [{ id: 50, holdings: { SPY: 0.6, 'GLD?L=2': 0.4 } }],
        indicators: [],
        tickers: [],
        definition: [{ allocationId: 50 }],
      },
    };

    const findOrCreateMock = vi.fn().mockResolvedValueOnce({ id: 42 }).mockResolvedValueOnce({ id: 43 });

    const mockStorage: StorageProvider = {
      tickers: { findOrCreate: findOrCreateMock },
      indicators: {
        findOrCreate: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        getValue: vi.fn(),
      },
      signals: {
        findOrCreate: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        getLastValue: vi.fn(),
      },
      allocations: { findOrCreate: vi.fn() },
      strategies: {
        create: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        resolveReference: vi.fn().mockResolvedValue(refData),
      },
      tradingDays: {
        getRange: vi.fn(),
        getLatestClosed: vi.fn(),
      },
    };
    const mockMarket: MarketProvider = { fetchBars: vi.fn() };

    const handle = new StrategyHandle(mockStorage, mockMarket, 'abc123');
    await handle.resolve();

    // Allocation tickers should NOT be pre-resolved — they should resolve lazily
    const alloc = handle.rules[0].hold;
    const [spyTicker] = alloc.holdings[0];
    const [gldTicker] = alloc.holdings[1];

    // Resolve tickers — should call findOrCreate, not return id=0
    const spyResult = await spyTicker.resolve();
    const gldResult = await gldTicker.resolve();

    expect(spyResult.id).toBe(42);
    expect(gldResult.id).toBe(43);
    expect(findOrCreateMock).toHaveBeenCalledWith('SPY', 1);
    expect(findOrCreateMock).toHaveBeenCalledWith('GLD', 2);
  });

  it('throws on invalid link_id', async () => {
    const mockStorage: StorageProvider = {
      tickers: { findOrCreate: vi.fn() },
      indicators: {
        findOrCreate: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        getValue: vi.fn(),
      },
      signals: {
        findOrCreate: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        getLastValue: vi.fn(),
      },
      allocations: { findOrCreate: vi.fn() },
      strategies: {
        create: vi.fn(),
        getSeries: vi.fn(),
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn(),
        resolveReference: vi.fn().mockRejectedValue(new Error('not found')),
      },
      tradingDays: {
        getRange: vi.fn(),
        getLatestClosed: vi.fn(),
      },
    };
    const mockMarket: MarketProvider = { fetchBars: vi.fn() };

    const handle = new StrategyHandle(mockStorage, mockMarket, 'invalid');
    await expect(handle.resolve()).rejects.toThrow();
  });
});

describe('StrategyHandle.series', () => {
  it('syncs signals, evaluates strategy, and returns StrategyBar[]', async () => {
    const signalBars: DailyBar[] = [
      { date: '2025-01-06', value: 1 },
      { date: '2025-01-07', value: 0 },
    ];

    // Build pre-resolved handles
    const mockStorage = {} as StorageProvider;
    const mockMarket = {} as MarketProvider;
    const ind1 = IndicatorHandle.fromResolved(mockStorage, mockMarket, 10, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = IndicatorHandle.fromResolved(mockStorage, mockMarket, 11, {
      type: 'Threshold',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: 30,
    });
    const signal = SignalHandle.fromResolved(mockStorage, mockMarket, 100, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 0,
    });
    vi.spyOn(signal, 'series').mockResolvedValue(signalBars);

    const alloc1 = AllocationHandle.fromResolved(mockStorage, 50, [
      [TickerHandle.fromResolved(mockStorage, 1, 'SPY', 1), 1.0],
    ]);
    const alloc2 = AllocationHandle.fromResolved(mockStorage, 51, [
      [TickerHandle.fromResolved(mockStorage, 2, 'SHY', 1), 1.0],
    ]);

    const handle = new StrategyHandle(mockStorage, mockMarket, {
      name: 'Test',
      rules: [{ when: [signal], hold: alloc1 }, { hold: alloc2 }],
    });

    // Pre-resolve to skip create mode DB insert
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (handle as any)._resolvedId = 200;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (handle as any)._resolvedLinkId = 'test';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (handle as any)._allocationMap.set(50, alloc1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (handle as any)._allocationMap.set(51, alloc2);

    // Now mock storage for the sync flow
    const writeSeriesMock = vi.fn().mockResolvedValue(undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (handle as any)._storage = {
      tradingDays: {
        getLatestClosed: vi.fn().mockResolvedValue('2025-01-07'),
        getRange: vi.fn().mockResolvedValue(['2025-01-06', '2025-01-07']),
      },
      strategies: {
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        writeSeries: writeSeriesMock,
      },
    };

    // Spy on _querySeriesFromDb to return test data
    const queryResult: StrategyBar[] = [
      { date: '2025-01-06', allocation: alloc1 },
      { date: '2025-01-07', allocation: alloc2 },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(handle as any, '_querySeriesFromDb').mockResolvedValue(queryResult);

    const bars = await handle.series();

    expect(bars).toHaveLength(2);
    expect(bars[0].date).toBe('2025-01-06');
    expect(bars[0].allocation).toBe(alloc1);
    expect(bars[1].date).toBe('2025-01-07');
    expect(bars[1].allocation).toBe(alloc2);
    expect(writeSeriesMock).toHaveBeenCalled();
  });
});
