import { describe, it, expect, vi } from 'vitest';
import { runBacktest } from './run-backtest';
import { NYSEExchangeCalendar } from '../calendars';
import { FeatureRuntime } from '../features/runtime';
import { MemoryFeatureCache } from '../reference/memory-feature-cache';
import type { Strategy, Features } from './types';
import type { Asset, Bar } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { Executor } from '../interfaces/executor';
import type { Order, Fill } from '../orders/types';
import type { Portfolio } from '../portfolio/types';

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };

const initialPortfolio: Portfolio = {
  cash: 10_000,
  positions: [],
  t: new Date('2026-01-02T00:00:00Z'),
};

describe('runBacktest', () => {
  it('pumps a strategy across sessions and applies fills', async () => {
    let firstSession = true;
    const strategy: Strategy = {
      universe: () => [SPY],
      features: () => ({}),
      build: () => {
        if (firstSession) {
          firstSession = false;
          const order: Order = { id: 'o1', kind: 'open', asset: SPY, side: 'long', quantity: 1 };
          return [order];
        }
        return [];
      },
    };

    const dataFeed: DataFeed = {
      bars: async function* () {},
    };

    const executor: Executor = {
      submit: async (orders) => {
        const fills: Fill[] = [];
        for (const o of orders) {
          fills.push({
            orderRef: o.id,
            t: new Date('2026-01-06T00:00:00Z'),
            quantity: 1,
            price: 100,
            fees: 0,
          });
        }
        return fills;
      },
    };

    const result = await runBacktest({
      strategy,
      range: { from: new Date('2026-01-05T00:00:00Z'), to: new Date('2026-01-10T00:00:00Z') },
      initialPortfolio,
      dataFeed,
      executor,
      calendar: new NYSEExchangeCalendar(),
    });

    expect(result.snapshots).toHaveLength(5);
    expect(result.finalPortfolio.positions).toHaveLength(1);
    expect(result.finalPortfolio.positions[0]!.quantity).toBe(1);
    expect(result.finalPortfolio.cash).toBe(10_000 - 100);
  });

  it('returns empty result when range contains no sessions', async () => {
    const strategy: Strategy = {
      universe: () => [],
      features: () => ({}),
      build: () => [],
    };
    const dataFeed: DataFeed = { bars: async function* () {} };
    const executor: Executor = { submit: async () => [] };
    const result = await runBacktest({
      strategy,
      range: { from: new Date('2026-01-03T00:00:00Z'), to: new Date('2026-01-05T00:00:00Z') },
      initialPortfolio,
      dataFeed,
      executor,
      calendar: new NYSEExchangeCalendar(),
    });
    expect(result.snapshots).toHaveLength(0);
    expect(result.finalPortfolio).toEqual(initialPortfolio);
  });

  it('awaits async features() and forwards them to build()', async () => {
    let received: unknown = null;
    const strategy: Strategy<{ price: number }> = {
      universe: () => [SPY],
      features: async () => ({ price: 123 }),
      build: (f) => {
        received = f;
        return [];
      },
    };
    const dataFeed: DataFeed = { bars: async function* () {} };
    const executor: Executor = { submit: async () => [] };
    await runBacktest({
      strategy,
      range: { from: new Date('2026-01-05T00:00:00Z'), to: new Date('2026-01-08T00:00:00Z') },
      initialPortfolio,
      dataFeed,
      executor,
      calendar: new NYSEExchangeCalendar(),
    });
    expect(received).toEqual({ price: 123 });
  });
});

describe('runBacktest state threading', () => {
  it('threads state from initialState through every build call', async () => {
    type F = { x: number } & Features;
    type S = { tickCount: number };

    const buildSpy = vi.fn();
    const strategy: Strategy<F, S> = {
      universe: () => [],
      features: async () => ({ x: 1 }),
      initialState: () => ({ tickCount: 0 }),
      build: (features, _p, state, _t) => {
        buildSpy(state);
        return { orders: [], state: { tickCount: state.tickCount + 1 } };
      },
    };

    const calendar = new NYSEExchangeCalendar();
    const range = { from: new Date('2024-01-02'), to: new Date('2024-01-09') };
    const dataFeed: DataFeed = { bars: vi.fn().mockImplementation(async function* () {}) };

    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: { cash: 1000, positions: [] },
      dataFeed,
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
    });

    // Five trading days in that range. State should have advanced once per session.
    expect(buildSpy).toHaveBeenNthCalledWith(1, { tickCount: 0 });
    expect(buildSpy).toHaveBeenNthCalledWith(2, { tickCount: 1 });
    expect(buildSpy).toHaveBeenNthCalledWith(3, { tickCount: 2 });
    expect(result.finalState).toEqual({ tickCount: 5 });
  });

  it('treats state-less strategies as S = void (finalState is undefined)', async () => {
    const strategy: Strategy = {
      universe: () => [],
      features: async () => ({}),
      build: () => [],
    };
    const calendar = new NYSEExchangeCalendar();
    const range = { from: new Date('2024-01-02'), to: new Date('2024-01-09') };
    const dataFeed: DataFeed = { bars: vi.fn().mockImplementation(async function* () {}) };

    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: { cash: 1000, positions: [] },
      dataFeed,
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
    });

    expect(result.finalState).toBeUndefined();
  });

  it('returns initialState in finalState when sessions is empty', async () => {
    type S = { seeded: boolean };
    const strategy: Strategy<Features, S> = {
      universe: () => [],
      features: async () => ({}),
      initialState: () => ({ seeded: true }),
      build: (_f, _p, state, _t) => ({ orders: [], state }),
    };

    const calendar = new NYSEExchangeCalendar();
    // Saturday-only range — NYSE has zero sessions.
    const range = { from: new Date('2024-01-06'), to: new Date('2024-01-07') };
    const dataFeed: DataFeed = { bars: vi.fn().mockImplementation(async function* () {}) };

    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: { cash: 1000, positions: [] },
      dataFeed,
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
    });

    expect(result.snapshots).toHaveLength(0);
    expect(result.finalState).toEqual({ seeded: true });
  });
});

describe('BacktestResult bar lineage', () => {
  it('exposes per-asset bars accumulated during the run when featureRuntime is provided', async () => {
    const SPY: Asset = { kind: 'equity', id: 'SPY', symbol: 'SPY' };
    const fixtureBars: Bar[] = Array.from({ length: 5 }, (_, i) => ({
      t: new Date(Date.UTC(2024, 5, i + 3)), // June 3-7 weekdays
      open: 100 + i,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: 0,
    }));
    const dataFeed: DataFeed = {
      bars: vi.fn().mockImplementation(async function* () {
        for (const b of fixtureBars) yield b;
      }),
    };
    const featureCache = new MemoryFeatureCache();
    const range = { from: new Date('2024-06-03'), to: new Date('2024-06-08') };
    const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

    const strategy: Strategy<Features, void> = {
      universe: () => [SPY],
      features: async (universe) => {
        await runtime.compute({ kind: 'sma', period: 3 }, universe[0]!);
        return {};
      },
      build: () => [],
    };

    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: { cash: 1_000, positions: [] },
      dataFeed,
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar: new NYSEExchangeCalendar(),
      featureCache,
      featureRuntime: runtime,
    });

    expect(result.bars.size).toBe(1);
    expect(result.bars.get('SPY')?.length).toBe(5);
  });

  it('returns empty bars map when no featureRuntime is provided', async () => {
    const strategy: Strategy<Features, void> = {
      universe: () => [],
      features: async () => ({}),
      build: () => [],
    };
    const calendar = new NYSEExchangeCalendar();
    const range = { from: new Date('2024-01-02'), to: new Date('2024-01-09') };
    const dataFeed: DataFeed = { bars: vi.fn().mockImplementation(async function* () {}) };

    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: { cash: 1000, positions: [] },
      dataFeed,
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
    });

    expect(result.bars.size).toBe(0);
  });
});
