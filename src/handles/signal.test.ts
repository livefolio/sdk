// src/handles/signal.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SignalHandle } from './signal';
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
      getLatestBar: vi.fn().mockResolvedValue(null),
    },
    signals: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 100 }),
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
        findOrCreate: vi.fn().mockResolvedValueOnce({ id: 10 }).mockResolvedValueOnce({ id: 11 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
        getLatestBar: vi.fn().mockResolvedValue(null),
      },
      signals: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 100 }),
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
    expect(storage.signals.findOrCreate).toHaveBeenCalledWith({
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

    expect(storage.signals.findOrCreate).toHaveBeenCalledTimes(1);
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
    expect(storage.signals.findOrCreate).toHaveBeenCalledTimes(1);
  });
});

// ─── SignalHandle.computeAt — Issue 4: in-memory prevBool for hysteresis ──────

describe('SignalHandle.computeAt — Issue 4: prevBool from dateMap avoids storage read', () => {
  it('uses provided prevBool for hysteresis and does NOT call getLastValue', async () => {
    // Signal: v1 > v2 with 10% tolerance
    // v1 = 105, v2 = 100
    // upper = 100 * 1.10 = 110, lower = 100 * 0.90 = 90
    // With prevBool=true:  signal stays true if v1 >= lower (90) → 105 >= 90 → true
    // With prevBool=false: signal flips true  if v1 > upper (110) → 105 > 110 → false
    // So the result depends on prevBool — this verifies hysteresis is driven by prevBool.

    const getLastValueSpy = vi.fn().mockResolvedValue(null);
    const storage = mockStorage({
      signals: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 100 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getLastValue: getLastValueSpy,
      },
    });

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
      threshold: null,
    });

    const handle = SignalHandle.fromResolved(storage, market, 100, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 10,
    });

    // Stub computeAt on indicators to return controlled values
    vi.spyOn(ind1, 'computeAt').mockResolvedValue(105);
    vi.spyOn(ind2, 'computeAt').mockResolvedValue(100);

    // With prevBool=true: v1=105 >= lower=90 → true (stays in signal)
    const resultWithPrevTrue = await handle.computeAt('2026-04-17', undefined, true);
    expect(resultWithPrevTrue).toBe(true);
    expect(getLastValueSpy).not.toHaveBeenCalled();

    // With prevBool=false: v1=105 not > upper=110 → false (doesn't enter signal)
    const resultWithPrevFalse = await handle.computeAt('2026-04-17', undefined, false);
    expect(resultWithPrevFalse).toBe(false);
    expect(getLastValueSpy).not.toHaveBeenCalled();
  });

  it('falls back to getLastValue when prevBool is not provided', async () => {
    const getLastValueSpy = vi.fn().mockResolvedValue(1); // prev was true
    const storage = mockStorage({
      signals: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 100 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockResolvedValue(undefined),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getLastValue: getLastValueSpy,
      },
    });

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
      threshold: null,
    });

    const handle = SignalHandle.fromResolved(storage, market, 100, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 10,
    });

    vi.spyOn(ind1, 'computeAt').mockResolvedValue(105);
    vi.spyOn(ind2, 'computeAt').mockResolvedValue(100);

    // No prevBool provided → falls back to storage.getLastValue
    await handle.computeAt('2026-04-17', undefined);
    expect(getLastValueSpy).toHaveBeenCalled();
  });
});

// ─── SignalHandle.previewSeries tests ─────────────────────────────────────────

describe('SignalHandle.previewSeries', () => {
  const tradingDays = ['2026-04-14', '2026-04-15', '2026-04-16', '2026-04-17'];
  const yesterday = '2026-04-16';
  const today = '2026-04-17';

  it('appends today in-memory bool to stored historical series', async () => {
    const historical = [
      { date: '2026-04-14', value: 0 },
      { date: '2026-04-15', value: 0 },
      { date: yesterday, value: 0 },
    ];
    const writeSpy = vi.fn();
    const storage = mockStorage({
      signals: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 100 }),
        getSeries: vi.fn().mockResolvedValue(historical),
        writeSeries: writeSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue(yesterday),
        getLastValue: vi.fn().mockResolvedValue(0),
      },
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(tradingDays),
        getLatestClosed: vi.fn().mockResolvedValue(yesterday),
      },
    });

    const market = mockMarket();
    const ind1 = IndicatorHandle.fromResolved(storage, market, 10, {
      type: 'Price',
      ticker: TickerHandle.fromResolved(storage, 1, 'SPY', 1),
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
      threshold: 100,
    });

    vi.spyOn(ind1, 'computeAt').mockResolvedValue(110);
    vi.spyOn(ind2, 'computeAt').mockResolvedValue(100);

    const handle = SignalHandle.fromResolved(storage, market, 100, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 0,
    });

    const bars = await handle.previewSeries(today, { SPY: 110 });

    expect(bars).toHaveLength(4);
    expect(bars[3]).toEqual({ date: today, value: 1 });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('throws when date is not a trading day', async () => {
    const storage = mockStorage({
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(tradingDays),
        getLatestClosed: vi.fn().mockResolvedValue(yesterday),
      },
    });

    const market = mockMarket();
    const ind1 = IndicatorHandle.fromResolved(storage, market, 10, {
      type: 'Price',
      ticker: TickerHandle.fromResolved(storage, 1, 'SPY', 1),
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
      threshold: 100,
    });

    const handle = SignalHandle.fromResolved(storage, market, 100, {
      indicator1: ind1,
      indicator2: ind2,
      comparison: '>',
      tolerance: 0,
    });

    await expect(handle.previewSeries('2026-04-18', {})).rejects.toThrow('not a trading day');
  });
});
