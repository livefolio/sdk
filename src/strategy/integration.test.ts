import { describe, it, expect, vi } from 'vitest';
import { runBacktest, reconcile, runLive, type Strategy, type BacktestSnapshot } from '.';
import { MemoryFeatureCache, BacktestExecutor } from '../reference';
import { NYSEExchangeCalendar, Crypto24x7Calendar } from '../calendars';
import { FeatureRuntime } from '../features/runtime';
import type { Portfolio } from '../portfolio';
import type { Asset, Bar, DataFeed, StreamingBar, StreamingDataFeed } from '../interfaces';
import type { Features } from './types';

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };

describe('phase 1 smoke', () => {
  it('reconciles to 100% SPY across a week', async () => {
    const calendar = new NYSEExchangeCalendar();
    const dataFeed: DataFeed = { bars: async function* () {} };
    const cache = new MemoryFeatureCache();

    const prices = new Map<string, number>([['us:SPY', 400]]);
    const strategy: Strategy = {
      universe: () => [SPY],
      features: () => ({}),
      build: (_f, portfolio) => reconcile(new Map([['us:SPY', 1]]), portfolio, prices),
    };

    const executor = new BacktestExecutor({
      calendar,
      nextOpen: async () => ({ t: new Date('2026-01-06T00:00:00Z'), price: 400 }),
    });

    const initialPortfolio: Portfolio = {
      cash: 10_000,
      positions: [],
      t: new Date('2026-01-05T00:00:00Z'),
    };

    const result = await runBacktest({
      strategy,
      range: { from: new Date('2026-01-05T00:00:00Z'), to: new Date('2026-01-10T00:00:00Z') },
      initialPortfolio,
      dataFeed,
      executor,
      calendar,
      featureCache: cache,
    });

    expect(result.snapshots.length).toBe(5);
    expect(result.finalPortfolio.positions.length).toBeGreaterThan(0);
    expect(result.finalPortfolio.positions[0]!.asset.id).toBe('us:SPY');
    expect(result.finalPortfolio.cash).toBeLessThan(10_000);
  });
});

describe('replay -> live continuity', () => {
  it('runLive snapshots after replay match a single end-to-end backtest', async () => {
    const calendar = new Crypto24x7Calendar();
    // 21 days of bars at 00:00 UTC, ascending price (June 1-21, 2024).
    const allBars: Bar[] = Array.from({ length: 21 }, (_, i) => ({
      t: new Date(Date.UTC(2024, 5, i + 1)),
      open: 100 + i,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: 0,
    }));

    function feedFor(bars: Bar[]): DataFeed {
      return {
        bars: vi.fn().mockImplementation(async function* () {
          for (const b of bars) yield b;
        }),
      };
    }

    function makeStrategy(): Strategy<Features, void> {
      return {
        universe: () => [SPY],
        features: async () => ({}),
        // No-op: this test verifies replay->live plumbing, not strategy logic.
        build: () => [],
      };
    }

    // The strategy never emits orders, so the executor.submit branch in
    // applyFills is a no-op identity. We still need a valid BacktestExecutor
    // (constructor requires calendar + nextOpen); a stub that throws if ever
    // called surfaces accidental invocations loudly.
    function makeExecutor(): BacktestExecutor {
      return new BacktestExecutor({
        calendar,
        nextOpen: async () => {
          throw new Error('nextOpen should not be called when no orders are emitted');
        },
      });
    }

    const initialPortfolio: Portfolio = {
      cash: 10_000,
      positions: [],
      t: new Date(Date.UTC(2024, 5, 1)),
    };

    // ---- Test A: end-to-end backtest over 21 days ----
    const fullRange = {
      from: new Date(Date.UTC(2024, 5, 1)),
      to: new Date(Date.UTC(2024, 5, 22)),
    };
    const fullCache = new MemoryFeatureCache();
    const fullFeed = feedFor(allBars);
    const fullRuntime = new FeatureRuntime({
      dataFeed: fullFeed,
      featureCache: fullCache,
      range: fullRange,
      freq: '1d',
    });
    const fullResult = await runBacktest({
      strategy: makeStrategy(),
      range: fullRange,
      initialPortfolio,
      dataFeed: fullFeed,
      executor: makeExecutor(),
      calendar,
      featureCache: fullCache,
      featureRuntime: fullRuntime,
    });
    expect(fullResult.snapshots).toHaveLength(21);

    // ---- Test B: replay first 14 days, then live-stream days 15-21 ----
    const replayRange = {
      from: new Date(Date.UTC(2024, 5, 1)),
      to: new Date(Date.UTC(2024, 5, 15)),
    };
    const replayCache = new MemoryFeatureCache();
    const replayFeed = feedFor(allBars.slice(0, 14));
    const replayRuntime = new FeatureRuntime({
      dataFeed: replayFeed,
      featureCache: replayCache,
      range: replayRange,
      freq: '1d',
    });
    const replayResult = await runBacktest({
      strategy: makeStrategy(),
      range: replayRange,
      initialPortfolio,
      dataFeed: replayFeed,
      executor: makeExecutor(),
      calendar,
      featureCache: replayCache,
      featureRuntime: replayRuntime,
    });
    expect(replayResult.snapshots).toHaveLength(14);

    // Live ticks: one per session at 23:00 UTC on days 15-21. The next-day
    // boundary at 23:00 UTC of day N+1 will trigger a snapshot for day N.
    // A sentinel tick at June 22 00:01 UTC forces the final June 21 snapshot
    // to commit by crossing into a new (June 22) session.
    const liveTicks: StreamingBar[] = allBars.slice(14).map((b) => ({
      asset: SPY,
      bar: { ...b, t: new Date(b.t.getTime() + 23 * 3600 * 1000) },
    }));
    liveTicks.push({
      asset: SPY,
      bar: {
        t: new Date('2024-06-22T00:01:00Z'),
        open: 122,
        high: 122,
        low: 122,
        close: 122,
        volume: 0,
      },
    });

    const tickFeed: StreamingDataFeed = {
      async *subscribe() {
        for (const t of liveTicks) yield t;
      },
    };

    const liveSnapshots: BacktestSnapshot[] = [];
    for await (const ev of runLive({
      strategy: makeStrategy(),
      history: replayResult,
      dataFeed: tickFeed,
      executor: makeExecutor(),
      calendar,
    })) {
      if (ev.type === 'snapshot') liveSnapshots.push(ev);
    }
    expect(liveSnapshots).toHaveLength(7);

    // ---- Concatenate and compare to the full end-to-end run ----
    const combined = [...replayResult.snapshots, ...liveSnapshots];
    expect(combined).toHaveLength(21);
    for (let i = 0; i < 21; i++) {
      expect(combined[i]?.t.toISOString()).toBe(fullResult.snapshots[i]?.t.toISOString());
      expect(combined[i]?.portfolio.cash).toBe(fullResult.snapshots[i]?.portfolio.cash);
      expect(combined[i]?.orders).toEqual(fullResult.snapshots[i]?.orders);
    }
  });
});
