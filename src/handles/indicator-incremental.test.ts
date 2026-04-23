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

  it('scales raw override to leveraged scale before stepping RSI (leverage=3)', async () => {
    // Checkpoint state was built on the 3x-leveraged series; `prev=300` is the
    // leveraged close. The override gives a raw SPY price (101, +1% from raw
    // prev=100). Fast path must convert the raw 101 to the leveraged equivalent
    // (300 * (1 + 3 * 0.01) = 309) before stepping rsiNext — otherwise `change`
    // becomes 101 - 300 = -199 (a catastrophic "loss") and RSI collapses.
    //
    // With the fix: change = 309 - 300 = +9 → a small positive step, RSI
    // stays near its prior value of ~60.
    // Without the fix: change = 101 - 300 = -199 → RSI crashes toward 0.
    const storage = mkStorage({
      getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-20'),
      getLatestBar: vi.fn().mockResolvedValue({
        date: '2026-04-20',
        value: 60,
        metadata: { avgGain: 3, avgLoss: 2, prev: 300 },
      }),
    });
    const market = {
      fetchBars: vi.fn().mockResolvedValue([
        { date: '2026-04-20', value: 100 },
        { date: '2026-04-21', value: 101 },
      ]),
    } as unknown as MarketProvider;
    (storage.tradingDays.getRange as ReturnType<typeof vi.fn>).mockResolvedValue(['2026-04-20', '2026-04-21']);
    const ticker = { resolve: vi.fn().mockResolvedValue({ id: 1 }), symbol: 'SPY', leverage: 3 } as never;
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
    // Sanity bound: a +1% raw move on a 3x ticker with prior RSI ~60 cannot
    // shift RSI by more than a handful of points. A pre-fix run lands in the
    // low double digits or below; the fixed value should stay close to 60.
    expect(v!).toBeGreaterThan(55);
    expect(v!).toBeLessThan(75);
  });

  it('skips leverage scaling for rate tickers (DTB3 etc.)', async () => {
    // Rate tickers' stored series is raw by convention; no compounding should
    // be applied even when leverage > 1.
    const storage = mkStorage({
      getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-20'),
      getLatestBar: vi.fn().mockResolvedValue({
        date: '2026-04-20',
        value: 45,
        metadata: { avgGain: 0.05, avgLoss: 0.05, prev: 4.5 },
      }),
    });
    const market = {
      fetchBars: vi.fn().mockResolvedValue([
        { date: '2026-04-20', value: 4.5 },
        { date: '2026-04-21', value: 4.6 },
      ]),
    } as unknown as MarketProvider;
    (storage.tradingDays.getRange as ReturnType<typeof vi.fn>).mockResolvedValue(['2026-04-20', '2026-04-21']);
    // DTB3 is a recognised rate ticker.
    const ticker = { resolve: vi.fn().mockResolvedValue({ id: 1 }), symbol: 'DTB3', leverage: 3 } as never;
    const h = new IndicatorHandle(storage, market, {
      type: 'RSI',
      ticker,
      lookback: 14,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const v = await h.computeAt('2026-04-21', { DTB3: 4.6 });
    expect(v).not.toBeNull();
    // For a rate ticker, the raw value (4.6) is fed directly; change = 4.6 - 4.5 = +0.1
    // so RSI ticks up slightly from the 50-ish prior state.
    expect(v!).toBeGreaterThan(48);
    expect(v!).toBeLessThan(60);
  });
});
