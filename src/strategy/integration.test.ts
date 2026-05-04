import { describe, it, expect, vi } from 'vitest';
import { runBacktest, reconcile, runLive, type Strategy, type BacktestSnapshot } from '.';
import { MemoryFeatureCache, BacktestExecutor } from '../reference';
import { NYSEExchangeCalendar, Crypto24x7Calendar } from '../calendars';
import { FeatureRuntime } from '../features/runtime';
import type { Portfolio } from '../portfolio';
import type { Asset, Bar, DataFeed, StreamingBar, StreamingDataFeed } from '../interfaces';
import type { Order } from '../orders/types';
import type { Position } from '../portfolio/types';
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

    // State-bearing strategy: increments tickCount each session and emits a
    // 1-share rebalance buy of SPY every 5th session (sessions 5/10/15/20).
    // This exercises:
    //   (a) state continuity across the replay->live seam (live-mode buys at
    //       sessions 15 and 20 only fire if state was correctly threaded
    //       forward from replay's finalState.tickCount === 14);
    //   (b) order/fill/position continuity (replay produces 2 buys, live
    //       produces 2 more — both runs must match the full backtest);
    //   (c) cash + position-quantity arithmetic through applyFills.
    //
    // Order ids encode the tickCount at issue time (`buy-${n}`). This means
    // the assertion `liveOrders.map(o => o.id) === ['buy-15', 'buy-20']` is
    // a direct proof that the strategy received state values 15 and 20
    // during the live phase — i.e., state continuity worked.
    type StratState = { tickCount: number };
    function makeStrategy(): Strategy<Features, StratState> {
      return {
        universe: () => [SPY],
        features: async () => ({}),
        initialState: () => ({ tickCount: 0 }),
        build: (_features, _portfolio, state) => {
          const next = state.tickCount + 1;
          const orders: Order[] = [];
          if (next % 5 === 0) {
            // Use 'rebalance' (not 'open') so all buys accumulate into one
            // SPY position. With 'open' each buy creates a new position with
            // a fresh module-counter ID; that ID counter is global, so Test A
            // and Test B would assign different ids and break position-equality.
            orders.push({ kind: 'rebalance', id: `buy-${next}`, asset: SPY, delta: 1 });
          }
          return { orders, state: { tickCount: next } };
        },
      };
    }

    // Real nextOpen: returns the matching daily bar's open price. Both Test A
    // (full backtest) and Test B (replay+live) call submit on identical
    // session dates (midnight UTC of each trading day), so this pure-function
    // implementation produces identical fills across both paths — the
    // requirement for snapshot-by-snapshot continuity.
    const barAt = new Map(allBars.map((b) => [b.t.getTime(), b]));
    function makeExecutor(): BacktestExecutor {
      return new BacktestExecutor({
        calendar,
        nextOpen: async (_asset, t) => {
          const bar = barAt.get(t.getTime());
          if (!bar) throw new Error(`no bar for session ${t.toISOString()}`);
          return { t, price: bar.open };
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

    // Position IDs come from a module-global counter (`pos_1`, `pos_2`, ...).
    // Test A and Test B share the module, so the counter assigns different
    // ids in each run. Strip ids before comparing — every other field must
    // match exactly.
    const stripIds = (positions: ReadonlyArray<Position>) => positions.map(({ id: _id, ...rest }) => rest);

    for (let i = 0; i < 21; i++) {
      const live = combined[i]!;
      const full = fullResult.snapshots[i]!;
      expect(live.t.toISOString()).toBe(full.t.toISOString());
      expect(live.portfolio.cash).toBe(full.portfolio.cash);
      expect(live.orders).toEqual(full.orders);
      expect(live.fills).toEqual(full.fills);
      expect(stripIds(live.portfolio.positions)).toEqual(stripIds(full.portfolio.positions));
    }

    // Sanity check: the strategy is non-trivial. 4 buys at sessions 5/10/15/20.
    const allOrders = combined.flatMap((s) => s.orders);
    expect(allOrders.map((o) => o.id)).toEqual(['buy-5', 'buy-10', 'buy-15', 'buy-20']);
    const allFills = combined.flatMap((s) => s.fills);
    expect(allFills).toHaveLength(4);

    // State continuity: replay's finalState should reflect 14 incremented ticks.
    expect(replayResult.finalState).toEqual({ tickCount: 14 });

    // The live phase must have observed state values 15..21 — proven by the
    // fact that buys 15 and 20 only fire when the strategy's `build` receives
    // state.tickCount === 14 and === 19 respectively at session start. If
    // state were reset, we would see `buy-5` and `buy-10` repeated instead.
    const liveOrders = liveSnapshots.flatMap((s) => s.orders);
    expect(liveOrders.map((o) => o.id)).toEqual(['buy-15', 'buy-20']);

    // Final portfolio shape: 4 shares of SPY accumulated via 'rebalance' orders
    // (which merge into one position), and cash debited by the 4 fill costs
    // (prices = 100+4, 100+9, 100+14, 100+19 = 104+109+114+119 = 446).
    expect(combined[20]!.portfolio.positions).toHaveLength(1);
    expect(combined[20]!.portfolio.positions[0]!.quantity).toBe(4);
    expect(combined[20]!.portfolio.cash).toBe(10_000 - (104 + 109 + 114 + 119));
  });
});
