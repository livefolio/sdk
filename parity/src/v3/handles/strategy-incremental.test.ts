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

  it('re-derives latestClosed when the stored series already covers it (drift correction)', async () => {
    // Scenario: stored checkpoint equals latestClosed (yesterday's series was
    // written). Between that write and now, a signal value flipped in
    // signals_series — for example, an indicator backfill caused its derived
    // signal to be recomputed. Calling series() / value() again should
    // re-evaluate the latest day against the *current* signals and upsert a
    // correction, rather than short-circuiting.

    const writeSpy = vi.fn().mockResolvedValue(undefined);
    // Signal 50 now returns value=0 (FALSE) for 2026-04-21 — a flip from
    // whatever was used when the strategies_series row was first written.
    const signalGetSeriesSpy = vi.fn().mockResolvedValue([{ date: '2026-04-21', value: 0 }]);

    const storage: StorageProvider = {
      tickers: { upsert: vi.fn(), findOrCreate: vi.fn() },
      indicators: {} as StorageProvider['indicators'],
      signals: {
        upsert: vi.fn(),
        findOrCreate: vi.fn().mockResolvedValue({ id: 50 }),
        getSeries: signalGetSeriesSpy,
        writeSeries: vi.fn(),
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-21'),
        getLastValue: vi.fn().mockResolvedValue(0),
      },
      allocations: { findOrCreate: vi.fn().mockResolvedValue({ id: 7 }) },
      strategies: {
        create: vi.fn().mockResolvedValue({ id: 123 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: writeSpy,
        // Checkpoint already covers latestClosed — this is the "stale row"
        // scenario. Previous SDK behavior would early-exit and leave the
        // row alone; new behavior re-derives and upserts.
        getLatestSeriesDate: vi.fn().mockResolvedValue('2026-04-21'),
        // Stored allocation is 7 (from an earlier, now-stale write).
        getLatestAllocationId: vi.fn().mockResolvedValue(7),
        resolveReference: vi.fn(),
      },
      tradingDays: {
        getRange: vi.fn().mockResolvedValue(['2026-04-19', '2026-04-20', '2026-04-21']),
        getLatestClosed: vi.fn().mockResolvedValue('2026-04-21'),
      },
    };

    // Strategy with one signaled rule + fallback:
    //   rule 0: when signal 50 is TRUE  → allocation 8
    //   rule 1: fallback                → allocation 7 (stored)
    // With signal 50 now FALSE, rule 1 should fire and keep allocation 7.
    // With signal 50 TRUE the rule would pick allocation 8. We assert the
    // refresh emits an entry for 2026-04-21 either way — correctness of the
    // chosen allocation is covered by existing eval tests.
    const cashxTicker = {
      resolve: vi.fn().mockResolvedValue({ id: 10 }),
      symbol: 'CASHX',
      leverage: 1,
    } as never;
    const allocationA = {
      resolve: vi.fn().mockResolvedValue({ id: 7 }),
      id: 7,
      holdings: [[cashxTicker, 1]],
    } as never;
    const allocationB = {
      resolve: vi.fn().mockResolvedValue({ id: 8 }),
      id: 8,
      holdings: [[cashxTicker, 1]],
    } as never;
    const signal50 = {
      resolve: vi.fn().mockResolvedValue({ id: 50 }),
      id: 50,
      series: signalGetSeriesSpy,
      // `indicator1`/`indicator2` required on SignalHandle shape for the
      // strategy-handle resolve path; stub them to satisfy the interface.
      indicator1: { resolve: vi.fn().mockResolvedValue({ id: 100 }) },
      indicator2: { resolve: vi.fn().mockResolvedValue({ id: 101 }) },
    } as never;
    const market = { fetchBars: vi.fn().mockResolvedValue([]) } as unknown as MarketProvider;
    const strat = new StrategyHandle(storage, market, {
      name: 's',
      freq: 'Daily',
      offset: 0,
      rules: [{ when: [signal50], hold: allocationB }, { hold: allocationA }],
    });
    await (strat as unknown as { resolve: () => Promise<{ id: number }> }).resolve();
    await strat.series();

    // The key assertion: writeSpy is called with an entry for 2026-04-21,
    // even though the stored checkpoint already covered that date.
    expect(writeSpy).toHaveBeenCalled();
    const writeCall = writeSpy.mock.calls.at(-1)!;
    const entries = writeCall[1] as { date: string; allocationId: number }[];
    expect(entries.map((e) => e.date)).toEqual(['2026-04-21']);
    // With signal 50 FALSE (current stored state), rule 0 does not fire;
    // fallback rule 1 picks allocation 7. Either 7 (no drift) or 8 (if the
    // flip were the other direction) would exercise the fix path; here we
    // verify the SDK actually re-evaluated rather than short-circuiting.
    expect(entries[0]!.allocationId).toBe(7);
  });
});
