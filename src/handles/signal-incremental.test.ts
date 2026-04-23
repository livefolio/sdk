import { describe, it, expect, vi } from 'vitest';
import { SignalHandle } from './signal';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

describe('SignalHandle._sync — single-bar fast path', () => {
  it('uses indicator.computeAt + getLastValue when catching up exactly one trading day', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const ind1Series = vi.fn(); // must not be called in fast path
    const ind2Series = vi.fn();
    const ind1ComputeAt = vi.fn().mockResolvedValue(105);
    const ind2ComputeAt = vi.fn().mockResolvedValue(100);

    const storage: StorageProvider = {
      tickers: { upsert: vi.fn(), findOrCreate: vi.fn() },
      indicators: {} as StorageProvider['indicators'],
      signals: {
        upsert: vi.fn(),
        findOrCreate: vi.fn().mockResolvedValue({ id: 42 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: writeSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-20'),
        getLastValue: vi.fn().mockResolvedValue(0),
      },
      allocations: { findOrCreate: vi.fn() },
      strategies: {} as StorageProvider['strategies'],
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(['2026-04-20', '2026-04-21']),
        getLatestClosed: vi.fn().mockResolvedValue('2026-04-21'),
      },
    };

    const indicator1 = {
      resolve: vi.fn().mockResolvedValue({ id: 1 }),
      series: ind1Series,
      computeAt: ind1ComputeAt,
      type: 'Price',
    } as never;
    const indicator2 = {
      resolve: vi.fn().mockResolvedValue({ id: 2 }),
      series: ind2Series,
      computeAt: ind2ComputeAt,
      type: 'Price',
    } as never;

    const market = {} as MarketProvider;
    const h = new SignalHandle(storage, market, {
      indicator1,
      indicator2,
      comparison: '>',
      tolerance: 0,
    });
    await h.series();

    expect(ind1ComputeAt).toHaveBeenCalledWith('2026-04-21', undefined);
    expect(ind2ComputeAt).toHaveBeenCalledWith('2026-04-21', undefined);
    expect(ind1Series).not.toHaveBeenCalled();
    expect(ind2Series).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [, bars] = writeSpy.mock.calls.at(-1)!;
    expect(bars).toEqual([{ date: '2026-04-21', value: 1 }]); // 105 > 100
  });
});
