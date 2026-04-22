import { describe, it, expect, vi } from 'vitest';
import { StrategyHandle } from './strategy';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

describe('StrategyHandle._evaluate — checkpointed', () => {
  it('only emits entries for dates after the strategy checkpoint', async () => {
    const writeSpy = vi.fn().mockResolvedValue(undefined);
    const signalGetSeriesSpy = vi.fn().mockResolvedValue([{ date: '2026-04-21', value: 1 }]);

    const storage: StorageProvider = {
      tickers: { upsert: vi.fn(), findOrCreate: vi.fn() },
      indicators: {} as StorageProvider['indicators'],
      signals: {
        upsert: vi.fn(),
        findOrCreate: vi.fn().mockResolvedValue({ id: 50 }),
        getSeries: signalGetSeriesSpy,
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-21'),
        getLastValue: vi.fn().mockResolvedValue(1),
      },
      allocations: { findOrCreate: vi.fn().mockResolvedValue({ id: 7 }) },
      strategies: {
        create: vi.fn().mockResolvedValue({ id: 123 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: writeSpy,
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-20'),
        getLatestAllocationId: vi.fn().mockResolvedValue(7),
        resolveReference: vi.fn(),
      },
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(['2026-04-19', '2026-04-20', '2026-04-21']),
        getLatestClosed: vi.fn().mockResolvedValue('2026-04-21'),
      },
    };

    // Build a single-rule fallback strategy (no signals) that always holds the
    // allocation. This exercises the carry-forward from lastAllocId without
    // needing any signal evaluation.
    const cashxTicker = {
      resolve: vi.fn().mockResolvedValue({ id: 10 }),
      symbol: 'CASHX',
      leverage: 1,
    } as never;
    const allocation = {
      resolve: vi.fn().mockResolvedValue({ id: 7 }),
      id: 7,
      holdings: [[cashxTicker, 1]],
    } as never;
    const market = { fetchBars: vi.fn().mockResolvedValue([]) } as unknown as MarketProvider;
    const strat = new StrategyHandle(storage, market, {
      name: 's',
      freq: 'Daily',
      offset: 0,
      rules: [{ hold: allocation }],
    });
    await (strat as unknown as { resolve: () => Promise<{ id: number }> }).resolve();
    // Trigger the post-close sync path via series(); _ensureFresh calls _evaluate.
    await strat.series();

    // Verify entries only cover 2026-04-21 (the single new day after the checkpoint).
    const writeCall = writeSpy.mock.calls.at(-1)!;
    const entries = writeCall[1] as { date: string; allocationId: number }[];
    expect(entries.map((e) => e.date)).toEqual(['2026-04-21']);
    expect(entries[0]!.allocationId).toBe(7);
  });
});
