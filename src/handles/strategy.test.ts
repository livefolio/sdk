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
        getLatestBar: vi.fn().mockResolvedValue(null),
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
        getLatestAllocationId: vi.fn().mockResolvedValue(null),
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
        getLatestBar: vi.fn().mockResolvedValue(null),
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
        getLatestAllocationId: vi.fn().mockResolvedValue(null),
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
        getLatestBar: vi.fn().mockResolvedValue(null),
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
        getLatestAllocationId: vi.fn().mockResolvedValue(null),
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
        getLatestBar: vi.fn().mockResolvedValue(null),
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
        getLatestAllocationId: vi.fn().mockResolvedValue(null),
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
        getLatestBar: vi.fn().mockResolvedValue(null),
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
        getLatestAllocationId: vi.fn().mockResolvedValue(null),
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

describe('StrategyHandle.marketSymbols', () => {
  it('returns sorted unique symbols from hold allocations, excluding CASHX', () => {
    const cashx = new TickerHandle(storage, 'CASHX', 1);
    const spy = new TickerHandle(storage, 'SPY', 1);
    const allocCash = new AllocationHandle(storage, [[cashx, 1.0]]);
    const allocSpy = new AllocationHandle(storage, [[spy, 1.0]]);
    const handle = new StrategyHandle(storage, market, {
      name: 'Test',
      rules: [{ hold: allocSpy }, { hold: allocCash }],
    });
    // allocSpy contributes SPY; allocCash contributes CASHX which is skipped
    expect(handle.marketSymbols()).toEqual(['SPY']);
  });

  it('includes VIX indicator type as ^VIX', () => {
    const alloc = makeAllocation();
    const signal = makeSignal(); // indicator1 is VIX type
    const allocFallback = makeAllocation();
    const handle = new StrategyHandle(storage, market, {
      name: 'Test',
      rules: [{ when: [signal], hold: alloc }, { hold: allocFallback }],
    });
    const symbols = handle.marketSymbols();
    expect(symbols).toContain('^VIX');
    expect(symbols).toContain('SPY');
    expect(symbols).toEqual([...symbols].sort());
  });

  it('returns empty array when only CASHX holdings and no indicator tickers', () => {
    const cashx = new TickerHandle(storage, 'CASHX', 1);
    const alloc = new AllocationHandle(storage, [[cashx, 1.0]]);
    const handle = new StrategyHandle(storage, market, { name: 'Test', rules: [{ hold: alloc }] });
    expect(handle.marketSymbols()).toEqual([]);
  });

  it('deduplicates symbols appearing in multiple rules', () => {
    const spy = new TickerHandle(storage, 'SPY', 1);
    const alloc1 = new AllocationHandle(storage, [[spy, 1.0]]);
    const alloc2 = new AllocationHandle(storage, [[spy, 1.0]]);
    const handle = new StrategyHandle(storage, market, {
      name: 'Test',
      rules: [{ hold: alloc1 }, { hold: alloc2 }],
    });
    expect(handle.marketSymbols()).toEqual(['SPY']);
  });

  it('includes ticker symbols from signal indicators', () => {
    const spyTicker = new TickerHandle(storage, 'SPY', 1);
    const ind1 = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker: spyTicker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = new IndicatorHandle(storage, market, {
      type: 'SMA',
      ticker: spyTicker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const signal = new SignalHandle(storage, market, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 0,
    });
    const cashx = new TickerHandle(storage, 'CASHX', 1);
    const allocCash = new AllocationHandle(storage, [[cashx, 1.0]]);
    const allocFallback = new AllocationHandle(storage, [[cashx, 1.0]]);
    const handle = new StrategyHandle(storage, market, {
      name: 'Test',
      rules: [{ when: [signal], hold: allocCash }, { hold: allocFallback }],
    });
    // SPY appears via indicator tickers; CASHX skipped in holdings
    expect(handle.marketSymbols()).toEqual(['SPY']);
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

// ─── previewAllocation tests ───────────────────────────────────────────────

describe('StrategyHandle.previewAllocation', () => {
  // Trading days: 4 days, target date is the last one (today, not yet closed).
  const tradingDays = ['2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'];
  const targetDate = '2026-04-17';
  const yesterday = '2026-04-16';

  // Helper to build fully pre-resolved handles so we skip DB create/reference flows.
  function buildFixture(opts: {
    // Raw price bars the base market returns for SPY
    basePriceBars: DailyBar[];
    // Historical signal bars already persisted in storage
    historicalSignalBars: DailyBar[];
    // Historical indicator bars for ind1 (Price) and ind2 (Threshold) if needed
    historicalInd1Bars?: DailyBar[];
    // Spies to capture calls
    strategiesWriteSpy?: ReturnType<typeof vi.fn>;
    signalsWriteSpy?: ReturnType<typeof vi.fn>;
    indicatorsWriteSpy?: ReturnType<typeof vi.fn>;
    // SPY ticker leverage (default 1)
    leverage?: number;
    // Historical leveraged Price indicator bars (for leverage test)
    historicalLeveragedBars?: DailyBar[];
    // threshold for ind2 (default: 100 so "Price > 100" is the signal)
    threshold?: number;
  }) {
    const leverage = opts.leverage ?? 1;
    const threshold = opts.threshold ?? 100;

    const strategiesWriteSpy = opts.strategiesWriteSpy ?? vi.fn();
    const signalsWriteSpy = opts.signalsWriteSpy ?? vi.fn();
    const indicatorsWriteSpy = opts.indicatorsWriteSpy ?? vi.fn();

    // The base market returns raw price bars
    const baseMarket: MarketProvider = {
      fetchBars: vi.fn().mockResolvedValue(opts.basePriceBars),
    };

    // Build storage mock.
    //
    // Under the new storage-first computeAt, preview-path reads for the
    // underlying `SPY` raw price go through `tickers.findOrCreate('SPY', 1)` +
    // `indicators.findOrCreate({type:'Price', tickerId, ...})`. We need that to
    // resolve to a *different* indicator row than ind1 (which represents the
    // leveraged Price SPY when leverage > 1), otherwise raw and leveraged bars
    // collapse to one series and the leverage anchor is ignored.
    const mockStorage: StorageProvider = {
      tickers: {
        // ind1's ticker id is 1; the leverage=1 raw lookup gets id=2 so the
        // two routes end up at distinct indicator rows below.
        findOrCreate: vi.fn().mockImplementation(async (_sym: string, lev: number) => ({
          id: lev === leverage ? 1 : 2,
        })),
        upsert: vi.fn(),
      } as unknown as StorageProvider['tickers'],
      indicators: {
        // Raw Price SPY (lev=1 ticker, tickerId=2) → id 20; ind1 + everything
        // else → id 10. `getSeries` then splits leveraged vs raw bars.
        findOrCreate: vi.fn().mockImplementation(async (identity: { type: string; tickerId: number | null }) => {
          if (identity.type === 'Price' && identity.tickerId === 2) return { id: 20 };
          return { id: 10 };
        }),
        upsert: vi.fn(),
        getSeries: vi.fn().mockImplementation(async (indicatorId: number) => {
          // ind1 (id=10): leveraged Price series when provided, else raw.
          if (indicatorId === 10) {
            return opts.historicalLeveragedBars ?? opts.basePriceBars.filter((b) => b.date <= yesterday);
          }
          // Raw Price SPY (id=20): the storage-first preview lookup always gets
          // the raw (unleveraged) history — `_applyLeverage` handles the rest.
          if (indicatorId === 20) {
            return opts.basePriceBars.filter((b) => b.date <= yesterday);
          }
          // ind2 (id=11) is Threshold — no stored bars
          return [];
        }),
        writeSeries: indicatorsWriteSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue(yesterday),
        getValue: vi.fn().mockImplementation(async (_id: number, date?: string) => {
          // Returns the stored leveraged value for the anchor date
          const bars = opts.historicalLeveragedBars ?? opts.basePriceBars.filter((b) => b.date <= yesterday);
          if (!date) return bars[bars.length - 1]?.value ?? null;
          return bars.find((b) => b.date === date)?.value ?? null;
        }),
        getLatestBar: vi.fn().mockResolvedValue(null),
      },
      signals: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 100 }),
        upsert: vi.fn(),
        getSeries: vi.fn().mockResolvedValue(opts.historicalSignalBars),
        writeSeries: signalsWriteSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue(yesterday),
        getLastValue: vi.fn().mockResolvedValue(opts.historicalSignalBars.at(-1)?.value ?? null),
      },
      allocations: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 50 }),
      },
      strategies: {
        create: vi.fn().mockResolvedValue({ id: 200 }),
        getSeries: vi.fn().mockResolvedValue([{ date: yesterday, allocationId: 51 }]),
        writeSeries: strategiesWriteSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue(yesterday),
        getLatestAllocationId: vi.fn().mockResolvedValue(null),
        resolveReference: vi.fn(),
      },
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(tradingDays),
        getLatestClosed: vi.fn().mockResolvedValue(yesterday),
      },
    };

    // Build pre-resolved handles bottom-up
    const spyTicker = TickerHandle.fromResolved(mockStorage, 1, 'SPY', leverage);

    // ind1: Price indicator on SPY with leverage
    const ind1 = IndicatorHandle.fromResolved(mockStorage, baseMarket, 10, {
      type: 'Price',
      ticker: spyTicker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    // ind2: Threshold indicator (a fixed value to compare against)
    const ind2 = IndicatorHandle.fromResolved(mockStorage, baseMarket, 11, {
      type: 'Threshold',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold,
    });

    // signal: ind1 (Price) > ind2 (Threshold)
    const signal = SignalHandle.fromResolved(mockStorage, baseMarket, 100, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 0,
    });

    // Two allocations: primary (signal true) and fallback
    const allocPrimary = AllocationHandle.fromResolved(mockStorage, 50, [
      [TickerHandle.fromResolved(mockStorage, 1, 'SPY', leverage), 1.0],
    ]);
    const allocFallback = AllocationHandle.fromResolved(mockStorage, 51, [
      [TickerHandle.fromResolved(mockStorage, 2, 'SHY', 1), 1.0],
    ]);

    // Strategy: if signal, hold primary; else hold fallback (Daily freq = rebalance every day)
    const handle = new StrategyHandle(mockStorage, baseMarket, {
      name: 'Test',
      rules: [{ when: [signal], hold: allocPrimary }, { hold: allocFallback }],
    });

    // Pre-resolve to skip DB flows
    (handle as unknown as { _resolvedId: number })._resolvedId = 200;
    (handle as unknown as { _resolvedLinkId: string })._resolvedLinkId = 'test-link';
    (handle as unknown as { _allocationMap: Map<number, AllocationHandle> })._allocationMap.set(50, allocPrimary);
    (handle as unknown as { _allocationMap: Map<number, AllocationHandle> })._allocationMap.set(51, allocFallback);

    return {
      handle,
      allocPrimary,
      allocFallback,
      mockStorage,
      baseMarket,
      strategiesWriteSpy,
      signalsWriteSpy,
      indicatorsWriteSpy,
    };
  }

  it('returns primary allocation when quote override flips signal true', async () => {
    // Historical signal: false on all days up to yesterday (price was 99, threshold 100)
    const historicalSignalBars: DailyBar[] = [
      { date: '2026-04-14', value: 0 },
      { date: '2026-04-15', value: 0 },
      { date: '2026-04-16', value: 0 },
    ];
    // Base raw price bars: price was 99 up through yesterday
    const basePriceBars: DailyBar[] = [
      { date: '2026-04-14', value: 99 },
      { date: '2026-04-15', value: 99 },
      { date: '2026-04-16', value: 99 },
    ];

    const { handle, allocPrimary } = buildFixture({ basePriceBars, historicalSignalBars });

    // Override: today's price is 105 (> 100 threshold) — signal should flip true
    const result = await handle.previewAllocation(targetDate, { SPY: 105 });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(allocPrimary.id);
  });

  it('returns fallback allocation when quote override keeps signal false', async () => {
    // Historical: signal was false
    const historicalSignalBars: DailyBar[] = [
      { date: '2026-04-14', value: 0 },
      { date: '2026-04-15', value: 0 },
      { date: '2026-04-16', value: 0 },
    ];
    const basePriceBars: DailyBar[] = [
      { date: '2026-04-14', value: 99 },
      { date: '2026-04-15', value: 99 },
      { date: '2026-04-16', value: 99 },
    ];

    const { handle, allocFallback } = buildFixture({ basePriceBars, historicalSignalBars });

    // Override: today's price is 95 (still < 100 threshold) — signal stays false
    const result = await handle.previewAllocation(targetDate, { SPY: 95 });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(allocFallback.id);
  });

  it('uses yesterday-close as fallback when quoteOverrides omits the symbol', async () => {
    // Historical: signal was true (price was 105 > 100)
    const historicalSignalBars: DailyBar[] = [
      { date: '2026-04-14', value: 1 },
      { date: '2026-04-15', value: 1 },
      { date: '2026-04-16', value: 1 },
    ];
    // Base raw price bars: yesterday's close was 105 (signal true)
    const basePriceBars: DailyBar[] = [
      { date: '2026-04-14', value: 105 },
      { date: '2026-04-15', value: 105 },
      { date: '2026-04-16', value: 105 },
    ];

    const { handle, allocPrimary } = buildFixture({ basePriceBars, historicalSignalBars });

    // Pass empty overrides — overlay should fall back to yesterday's close (105)
    // which is still > 100, so signal stays true → primary allocation
    const result = await handle.previewAllocation(targetDate, {});

    expect(result).not.toBeNull();
    expect(result!.id).toBe(allocPrimary.id);
  });

  it('does not call writeSeries on strategies, signals, or indicators', async () => {
    const historicalSignalBars: DailyBar[] = [
      { date: '2026-04-14', value: 0 },
      { date: '2026-04-15', value: 0 },
      { date: '2026-04-16', value: 0 },
    ];
    const basePriceBars: DailyBar[] = [
      { date: '2026-04-14', value: 99 },
      { date: '2026-04-15', value: 99 },
      { date: '2026-04-16', value: 99 },
    ];

    const strategiesWriteSpy = vi.fn();
    const signalsWriteSpy = vi.fn();
    const indicatorsWriteSpy = vi.fn();

    const { handle } = buildFixture({
      basePriceBars,
      historicalSignalBars,
      strategiesWriteSpy,
      signalsWriteSpy,
      indicatorsWriteSpy,
    });

    await handle.previewAllocation(targetDate, { SPY: 105 });

    expect(strategiesWriteSpy).not.toHaveBeenCalled();
    expect(signalsWriteSpy).not.toHaveBeenCalled();
    expect(indicatorsWriteSpy).not.toHaveBeenCalled();
  });

  it('applies leverage correctly: uses leveragedYesterday * (1 + leverage * rawReturn)', async () => {
    // leverage=3, yesterday raw=100, yesterday leveraged=300
    // today raw=102 → rawReturn=0.02 → leveraged today = 300*(1+3*0.02) = 318
    // threshold=310 → signal: leveraged(318) > threshold(310) → true → primary
    const leverage = 3;
    const threshold = 310;

    const historicalSignalBars: DailyBar[] = [
      { date: '2026-04-14', value: 0 },
      { date: '2026-04-15', value: 0 },
      { date: '2026-04-16', value: 0 },
    ];
    // Raw price bars (unleveraged): yesterday raw was 100
    const basePriceBars: DailyBar[] = [
      { date: '2026-04-14', value: 100 },
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 100 },
    ];
    // Yesterday's stored leveraged value = 300 (anchored start = 100, but leverage=3 means 300)
    const historicalLeveragedBars: DailyBar[] = [
      { date: '2026-04-14', value: 300 },
      { date: '2026-04-15', value: 300 },
      { date: '2026-04-16', value: 300 },
    ];

    const { handle, allocPrimary } = buildFixture({
      basePriceBars,
      historicalSignalBars,
      leverage,
      threshold,
      historicalLeveragedBars,
    });

    // Override: today raw = 102 → leveraged = 300 * (1 + 3 * 0.02) = 318 > 310 → primary
    const result = await handle.previewAllocation(targetDate, { SPY: 102 });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(allocPrimary.id);
  });

  it('leverage boundary: just below threshold gives fallback allocation', async () => {
    // leverage=3, yesterday raw=100, yesterday leveraged=300
    // today raw=101 → rawReturn=0.01 → leveraged today = 300*(1+3*0.01) = 309
    // threshold=310 → signal: 309 > 310 → false → fallback
    const leverage = 3;
    const threshold = 310;

    const historicalSignalBars: DailyBar[] = [
      { date: '2026-04-14', value: 0 },
      { date: '2026-04-15', value: 0 },
      { date: '2026-04-16', value: 0 },
    ];
    const basePriceBars: DailyBar[] = [
      { date: '2026-04-14', value: 100 },
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 100 },
    ];
    const historicalLeveragedBars: DailyBar[] = [
      { date: '2026-04-14', value: 300 },
      { date: '2026-04-15', value: 300 },
      { date: '2026-04-16', value: 300 },
    ];

    const { handle, allocFallback } = buildFixture({
      basePriceBars,
      historicalSignalBars,
      leverage,
      threshold,
      historicalLeveragedBars,
    });

    // today raw = 101 → leveraged = 300*(1+3*0.01) = 309 < 310 → fallback
    const result = await handle.previewAllocation(targetDate, { SPY: 101 });

    expect(result).not.toBeNull();
    expect(result!.id).toBe(allocFallback.id);
  });

  it('throws when date is not a trading day', async () => {
    const { handle } = buildFixture({
      basePriceBars: [],
      historicalSignalBars: [],
    });

    await expect(handle.previewAllocation('2026-04-18', {})).rejects.toThrow('not a trading day');
  });
});

// ─── previewSeries tests ───────────────────────────────────────────────────

describe('StrategyHandle.previewSeries', () => {
  const tradingDays = ['2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'];
  const targetDate = '2026-04-17';
  const yesterday = '2026-04-16';

  function buildFixture(opts: {
    basePriceBars: DailyBar[];
    historicalSignalBars: DailyBar[];
    storedAllocationSeries: Array<{ date: string; allocationId: number }>;
    strategiesWriteSpy?: ReturnType<typeof vi.fn>;
    signalsWriteSpy?: ReturnType<typeof vi.fn>;
    indicatorsWriteSpy?: ReturnType<typeof vi.fn>;
    leverage?: number;
    historicalLeveragedBars?: DailyBar[];
    threshold?: number;
  }) {
    const leverage = opts.leverage ?? 1;
    const threshold = opts.threshold ?? 100;

    const strategiesWriteSpy = opts.strategiesWriteSpy ?? vi.fn();
    const signalsWriteSpy = opts.signalsWriteSpy ?? vi.fn();
    const indicatorsWriteSpy = opts.indicatorsWriteSpy ?? vi.fn();

    const baseMarket: MarketProvider = {
      fetchBars: vi.fn().mockResolvedValue(opts.basePriceBars),
    };

    const mockStorage: StorageProvider = {
      tickers: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
        upsert: vi.fn(),
      } as unknown as StorageProvider['tickers'],
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
        upsert: vi.fn(),
        getSeries: vi.fn().mockImplementation(async (indicatorId: number) => {
          if (indicatorId === 10) {
            return opts.historicalLeveragedBars ?? opts.basePriceBars.filter((b) => b.date <= yesterday);
          }
          return [];
        }),
        writeSeries: indicatorsWriteSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue(yesterday),
        getValue: vi.fn().mockImplementation(async (_id: number, date?: string) => {
          const bars = opts.historicalLeveragedBars ?? opts.basePriceBars.filter((b) => b.date <= yesterday);
          if (!date) return bars[bars.length - 1]?.value ?? null;
          return bars.find((b) => b.date === date)?.value ?? null;
        }),
        getLatestBar: vi.fn().mockResolvedValue(null),
      },
      signals: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 100 }),
        upsert: vi.fn(),
        getSeries: vi.fn().mockResolvedValue(opts.historicalSignalBars),
        writeSeries: signalsWriteSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue(yesterday),
        getLastValue: vi.fn().mockResolvedValue(opts.historicalSignalBars.at(-1)?.value ?? null),
      },
      allocations: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 50 }),
      },
      strategies: {
        create: vi.fn().mockResolvedValue({ id: 200 }),
        getSeries: vi.fn().mockResolvedValue(opts.storedAllocationSeries),
        writeSeries: strategiesWriteSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue(yesterday),
        getLatestAllocationId: vi.fn().mockResolvedValue(null),
        resolveReference: vi.fn(),
      },
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(tradingDays),
        getLatestClosed: vi.fn().mockResolvedValue(yesterday),
      },
    };

    const spyTicker = TickerHandle.fromResolved(mockStorage, 1, 'SPY', leverage);

    const ind1 = IndicatorHandle.fromResolved(mockStorage, baseMarket, 10, {
      type: 'Price',
      ticker: spyTicker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = IndicatorHandle.fromResolved(mockStorage, baseMarket, 11, {
      type: 'Threshold',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold,
    });

    const signal = SignalHandle.fromResolved(mockStorage, baseMarket, 100, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 0,
    });

    const allocPrimary = AllocationHandle.fromResolved(mockStorage, 50, [
      [TickerHandle.fromResolved(mockStorage, 1, 'SPY', leverage), 1.0],
    ]);
    const allocFallback = AllocationHandle.fromResolved(mockStorage, 51, [
      [TickerHandle.fromResolved(mockStorage, 2, 'SHY', 1), 1.0],
    ]);

    const handle = new StrategyHandle(mockStorage, baseMarket, {
      name: 'Test',
      rules: [{ when: [signal], hold: allocPrimary }, { hold: allocFallback }],
    });

    (handle as unknown as { _resolvedId: number })._resolvedId = 200;
    (handle as unknown as { _resolvedLinkId: string })._resolvedLinkId = 'test-link';
    (handle as unknown as { _allocationMap: Map<number, AllocationHandle> })._allocationMap.set(50, allocPrimary);
    (handle as unknown as { _allocationMap: Map<number, AllocationHandle> })._allocationMap.set(51, allocFallback);

    return {
      handle,
      allocPrimary,
      allocFallback,
      strategiesWriteSpy,
      signalsWriteSpy,
      indicatorsWriteSpy,
    };
  }

  it('appends today preview bar to stored allocation series', async () => {
    const basePriceBars: DailyBar[] = [
      { date: '2026-04-14', value: 99 },
      { date: '2026-04-15', value: 99 },
      { date: yesterday, value: 99 },
    ];
    const historicalSignalBars: DailyBar[] = [
      { date: '2026-04-14', value: 0 },
      { date: '2026-04-15', value: 0 },
      { date: yesterday, value: 0 },
    ];
    const storedAllocationSeries = [
      { date: '2026-04-14', allocationId: 51 },
      { date: '2026-04-15', allocationId: 51 },
      { date: yesterday, allocationId: 51 },
    ];

    const { handle, allocPrimary, allocFallback } = buildFixture({
      basePriceBars,
      historicalSignalBars,
      storedAllocationSeries,
    });

    // Override flips signal true today → primary
    const bars = await handle.previewSeries(targetDate, { SPY: 105 });

    expect(bars).toHaveLength(4);
    expect(bars[0]!.allocation.id).toBe(allocFallback.id);
    expect(bars[1]!.allocation.id).toBe(allocFallback.id);
    expect(bars[2]!.allocation.id).toBe(allocFallback.id);
    expect(bars[3]!.date).toBe(targetDate);
    expect(bars[3]!.allocation.id).toBe(allocPrimary.id);
  });

  it('does not write to storage on preview path', async () => {
    const basePriceBars: DailyBar[] = [
      { date: '2026-04-14', value: 99 },
      { date: '2026-04-15', value: 99 },
      { date: yesterday, value: 99 },
    ];
    const historicalSignalBars: DailyBar[] = [
      { date: '2026-04-14', value: 0 },
      { date: '2026-04-15', value: 0 },
      { date: yesterday, value: 0 },
    ];
    const storedAllocationSeries = [
      { date: '2026-04-14', allocationId: 51 },
      { date: '2026-04-15', allocationId: 51 },
      { date: yesterday, allocationId: 51 },
    ];

    const strategiesWriteSpy = vi.fn();
    const signalsWriteSpy = vi.fn();
    const indicatorsWriteSpy = vi.fn();

    const { handle } = buildFixture({
      basePriceBars,
      historicalSignalBars,
      storedAllocationSeries,
      strategiesWriteSpy,
      signalsWriteSpy,
      indicatorsWriteSpy,
    });

    await handle.previewSeries(targetDate, { SPY: 105 });

    expect(strategiesWriteSpy).not.toHaveBeenCalled();
    expect(signalsWriteSpy).not.toHaveBeenCalled();
    expect(indicatorsWriteSpy).not.toHaveBeenCalled();
  });

  it('throws when date is not a trading day', async () => {
    const { handle } = buildFixture({
      basePriceBars: [],
      historicalSignalBars: [],
      storedAllocationSeries: [],
    });

    await expect(handle.previewSeries('2026-04-18', {})).rejects.toThrow('not a trading day');
  });
});
