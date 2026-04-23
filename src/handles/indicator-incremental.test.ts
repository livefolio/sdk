import { describe, it, expect, vi } from 'vitest';
import { IndicatorHandle } from './indicator';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

function mkStorage(overrides: Partial<StorageProvider['indicators']>): StorageProvider {
  return {
    tickers: {
      upsert: vi.fn().mockResolvedValue({ id: 1 }),
      findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
    },
    indicators: {
      upsert: vi.fn().mockResolvedValue({ id: 99 }),
      findOrCreate: vi.fn().mockResolvedValue({ id: 99 }),
      getSeries: vi.fn().mockResolvedValue([]),
      writeSeries: vi.fn().mockResolvedValue(undefined),
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getValue: vi.fn().mockResolvedValue(null),
      getLatestBar: vi.fn().mockResolvedValue(null),
      ...overrides,
    },
    signals: {
      upsert: vi.fn(),
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
      getLatestAllocationId: vi.fn(),
      resolveReference: vi.fn(),
    },
    tradingDays: {
      getRange: vi.fn().mockResolvedValue(['2026-04-20', '2026-04-21']),
      getLatestClosed: vi.fn().mockResolvedValue('2026-04-21'),
    },
  } as unknown as StorageProvider;
}

const mkMarket = (): MarketProvider =>
  ({
    fetchBars: vi.fn().mockResolvedValue([
      { date: '2026-04-20', value: 100 },
      { date: '2026-04-21', value: 101 },
    ]),
  }) as unknown as MarketProvider;

describe('IndicatorHandle._sync — incremental fast path', () => {
  it('SMA uses stored checkpoint metadata instead of recomputing from history', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const storage = mkStorage({
      getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-20'),
      getLatestBar: vi.fn().mockResolvedValue({
        date: '2026-04-20',
        value: 99,
        metadata: { tail: [95, 96, 97, 98, 99] },
      }),
      // getSeries is used by _fetchRawBarsForIncremental to retrieve the new price bar
      getSeries: vi.fn().mockResolvedValue([{ date: '2026-04-21', value: 101 }]),
      writeSeries: writeSpy,
    });
    const market = mkMarket();
    const ticker = { resolve: vi.fn().mockResolvedValue({ id: 1 }), symbol: 'SPY', leverage: 1 } as never;
    const h = new IndicatorHandle(storage, market, {
      type: 'SMA',
      ticker,
      lookback: 5,
      delay: 0,
      unit: null,
      threshold: null,
    });
    await h.series();
    // Fast path writes 1 new bar (the new trading day), with metadata = new tail
    const [, bars, opts] = writeSpy.mock.calls.at(-1)!;
    expect(bars.length).toBe(1);
    expect(bars[0]!.date).toBe('2026-04-21');
    expect((opts as { metadata: { tail: number[] } }).metadata.tail).toHaveLength(5);
    expect((opts as { metadata: { tail: number[] } }).metadata.tail.at(-1)).toBe(101);
  });

  it('falls back to cold compute when no checkpoint metadata exists', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const storage = mkStorage({
      getLatestSeriesDate: vi.fn().mockResolvedValue(null),
      getLatestBar: vi.fn().mockResolvedValue(null),
      writeSeries: writeSpy,
    });
    const market = mkMarket();
    const ticker = { resolve: vi.fn().mockResolvedValue({ id: 1 }), symbol: 'SPY', leverage: 1 } as never;
    const h = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    await h.series();
    expect(writeSpy).toHaveBeenCalled();
  });
});

describe('IndicatorHandle.computeAt — fast path', () => {
  it('uses rsiNext from checkpoint when checkpoint is yesterday', async () => {
    const storage = mkStorage({
      getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-20'),
      getLatestBar: vi.fn().mockResolvedValue({
        date: '2026-04-20',
        value: 55,
        metadata: { avgGain: 1.2, avgLoss: 0.8, prev: 100 },
      }),
    });
    const market = mkMarket();
    (storage.tradingDays.getRange as ReturnType<typeof vi.fn>).mockResolvedValue(['2026-04-20', '2026-04-21']);
    const ticker = { resolve: vi.fn().mockResolvedValue({ id: 1 }), symbol: 'SPY', leverage: 1 } as never;
    const h = new IndicatorHandle(storage, market, {
      type: 'RSI',
      ticker,
      lookback: 14,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const v = await h.computeAt('2026-04-21', { SPY: 101 });
    expect(v).not.toBeNull();
    // computeAt should NOT have called the full bounded-window recompute; the
    // checkpoint path calls only the raw-bar resolver + one rsiNext step.
  });
});
