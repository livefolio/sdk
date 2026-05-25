import { describe, it, expect, vi } from 'vitest';
import type { Asset, Bar } from '../interfaces/types';
import type { StreamingDataFeed, StreamingBar } from '../interfaces/streaming-data-feed';
import type { Strategy, Features } from './types';
import type { BacktestResult } from './run-backtest';
import { runLive, CashEventQueue } from './run-live';
import { Crypto24x7Calendar } from '../calendars/crypto-24x7';
import { NYSEExchangeCalendar } from '../calendars/nyse';
import { FeatureRuntime } from '../features/runtime';
import { MemoryFeatureCache } from '../reference/memory-feature-cache';

const SPY: Asset = { kind: 'equity', id: 'SPY', symbol: 'SPY' };

function tickStream(ticks: StreamingBar[]): StreamingDataFeed {
  return {
    async *subscribe() {
      for (const t of ticks) yield t;
    },
  };
}

function bar(t: string, price: number): Bar {
  return { t: new Date(t), open: price, high: price, low: price, close: price, volume: 0 };
}

describe('runLive', () => {
  it('emits a mark event for each tick within a session', async () => {
    const calendar = new Crypto24x7Calendar();
    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2024-06-03T12:00:00Z', 100) },
      { asset: SPY, bar: bar('2024-06-03T13:00:00Z', 101) },
      { asset: SPY, bar: bar('2024-06-03T14:00:00Z', 102) },
    ];

    const strategy: Strategy<Features, void> = {
      universe: () => [SPY],
      features: async () => ({}),
      build: () => [],
    };

    const history: BacktestResult<void> = {
      snapshots: [],
      finalPortfolio: { cash: 1000, positions: [], t: new Date('2024-06-03T00:00:00Z') },
      finalState: undefined,
      bars: new Map(),
    };

    const events = [];
    for await (const ev of runLive({
      strategy,
      history,
      dataFeed: tickStream(ticks),
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
    })) {
      events.push(ev);
    }

    // All three ticks were within "today" (no session boundary crossed) — three marks, no snapshots.
    expect(events.filter((e) => e.type === 'mark')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'snapshot')).toHaveLength(0);
  });

  it('emits a snapshot when a tick crosses the session boundary', async () => {
    const calendar = new Crypto24x7Calendar();
    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2024-06-03T23:00:00Z', 100) }, // last tick of day 1
      { asset: SPY, bar: bar('2024-06-04T01:00:00Z', 105) }, // first tick of day 2
    ];

    const buildSpy = vi.fn().mockReturnValue({ orders: [], state: undefined });
    const strategy: Strategy<Features, void> = {
      universe: () => [SPY],
      features: async () => ({}),
      build: buildSpy,
    };
    const history: BacktestResult<void> = {
      snapshots: [],
      finalPortfolio: { cash: 1000, positions: [], t: new Date('2024-06-03T00:00:00Z') },
      finalState: undefined,
      bars: new Map(),
    };

    const events = [];
    for await (const ev of runLive({
      strategy,
      history,
      dataFeed: tickStream(ticks),
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
    })) {
      events.push(ev);
    }

    // Tick 1: mark (within day 1).
    // Tick 2: detects boundary → snapshot for day 1 close, then mark for day 2.
    const snapshots = events.filter((e) => e.type === 'snapshot');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.t.toISOString()).toBe('2024-06-03T00:00:00.000Z');
  });

  it('preview-build does NOT corrupt committed state', async () => {
    const calendar = new Crypto24x7Calendar();
    type S = { tickCount: number };

    // Track every state value that build receives.
    const stateAtCall: S[] = [];
    const strategy: Strategy<Features, S> = {
      universe: () => [SPY],
      features: async () => ({}),
      initialState: () => ({ tickCount: 0 }),
      build: (_f, _p, state, _t) => {
        // Snapshot the *received* state (deep clone, since previews mutate their copy).
        stateAtCall.push({ tickCount: state.tickCount });
        return { orders: [], state: { tickCount: state.tickCount + 1 } };
      },
    };

    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2024-06-03T10:00:00Z', 100) },
      { asset: SPY, bar: bar('2024-06-03T11:00:00Z', 101) },
      { asset: SPY, bar: bar('2024-06-03T12:00:00Z', 102) },
      { asset: SPY, bar: bar('2024-06-04T00:01:00Z', 103) }, // boundary
    ];

    const history: BacktestResult<S> = {
      snapshots: [],
      finalPortfolio: { cash: 1000, positions: [], t: new Date('2024-06-03T00:00:00Z') },
      finalState: { tickCount: 0 },
      bars: new Map(),
    };

    const events = [];
    for await (const ev of runLive({
      strategy,
      history,
      dataFeed: tickStream(ticks),
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
    })) {
      events.push(ev);
    }

    // Expected build calls (in order):
    //   tick 1: preview (state=0) → tickCount: 0
    //   tick 2: preview (state=0)
    //   tick 3: preview (state=0)
    //   tick 4: COMMIT for day 1 (state=0 — committed state untouched by previews)
    //   tick 4: preview for day 2 (state=1 — committed state advanced by the one commit only)
    // If previews leaked state into committed state, the COMMIT call would receive
    // tickCount > 0, OR the post-commit preview would receive tickCount > 1.
    expect(stateAtCall).toEqual([
      { tickCount: 0 }, // preview tick 1
      { tickCount: 0 }, // preview tick 2
      { tickCount: 0 }, // preview tick 3
      { tickCount: 0 }, // commit (boundary on tick 4)
      { tickCount: 1 }, // preview tick 4 (after commit)
    ]);

    // 3 marks (day 1) + 1 snapshot (commit) + 1 mark (day 2) = 5 events.
    expect(events).toHaveLength(5);
    expect(events.filter((e) => e.type === 'snapshot')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'mark')).toHaveLength(4);
  });

  it('uses calendar.next for boundary detection (NYSE after-hours tick stays in session)', async () => {
    const calendar = new NYSEExchangeCalendar();
    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2024-06-03T20:00:00Z', 100) }, // Mon 16:00 ET (close)
      { asset: SPY, bar: bar('2024-06-03T22:00:00Z', 101) }, // Mon 18:00 ET (after-hours)
      { asset: SPY, bar: bar('2024-06-04T13:30:00Z', 102) }, // Tue 09:30 ET (open)
    ];
    const buildSpy = vi.fn().mockReturnValue({ orders: [], state: undefined });
    const strategy: Strategy<Features, void> = {
      universe: () => [SPY],
      features: async () => ({}),
      build: buildSpy,
    };
    const history: BacktestResult<void> = {
      snapshots: [],
      finalPortfolio: { cash: 1000, positions: [], t: new Date('2024-06-03T00:00:00Z') },
      finalState: undefined,
      bars: new Map(),
    };

    const events = [];
    for await (const ev of runLive({
      strategy,
      history,
      dataFeed: tickStream(ticks),
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
    })) {
      events.push(ev);
    }

    // Both Monday ticks (20:00 UTC and 22:00 UTC) belong to Monday's session
    // per NYSE calendar — the after-hours tick at 22:00 must NOT trigger a
    // boundary. Tuesday's tick (13:30 UTC = 09:30 ET) crosses into a new
    // session, triggering exactly one snapshot for Monday.
    const snapshots = events.filter((e) => e.type === 'snapshot');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.t.toISOString().startsWith('2024-06-03')).toBe(true);
  });

  it('uses provided streamingRuntime instead of constructing one', async () => {
    const calendar = new Crypto24x7Calendar();
    const cache = new MemoryFeatureCache();
    const sharedRuntime = new FeatureRuntime({
      mode: 'streaming',
      featureCache: cache,
      freq: '1d',
    });
    const appendSpy = vi.spyOn(sharedRuntime, 'appendBar');

    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2024-06-03T12:00:00Z', 100) },
      { asset: SPY, bar: bar('2024-06-04T01:00:00Z', 101) }, // boundary
    ];
    const strategy: Strategy<Features, void> = {
      universe: () => [SPY],
      features: async () => ({}),
      build: () => [],
    };
    const history: BacktestResult<void> = {
      snapshots: [],
      finalPortfolio: { cash: 1000, positions: [], t: new Date('2024-06-03T00:00:00Z') },
      finalState: undefined,
      bars: new Map(),
    };

    for await (const _ev of runLive({
      strategy,
      history,
      dataFeed: tickStream(ticks),
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
      streamingRuntime: sharedRuntime,
    })) {
      // drain
      void _ev;
    }

    // Boundary at tick 2 → finalizeBars(day 1) → appendBar on the SHARED runtime.
    expect(appendSpy).toHaveBeenCalled();
  });

  it('applies a seeded cash event at session close, before the snapshot', async () => {
    const calendar = new Crypto24x7Calendar();
    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2024-06-03T23:00:00Z', 100) }, // day 1 (session = 2024-06-03)
      { asset: SPY, bar: bar('2024-06-04T01:00:00Z', 105) }, // day 2 → closes day 1
    ];
    const strategy: Strategy<Features, void> = {
      universe: () => [SPY],
      features: async () => ({}),
      build: () => [],
    };
    const history: BacktestResult<void> = {
      snapshots: [],
      finalPortfolio: { cash: 1000, positions: [], t: new Date('2024-06-03T00:00:00Z') },
      finalState: undefined,
      bars: new Map(),
    };

    const events = [];
    for await (const ev of runLive({
      strategy,
      history,
      dataFeed: tickStream(ticks),
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
      // Due by the day-1 session close (2024-06-03T00:00:00Z).
      cashEvents: [{ t: new Date('2024-06-03T00:00:00Z'), delta: 1000, reason: 'deposit' }],
    })) {
      events.push(ev);
    }

    const cashEvents = events.filter((e) => e.type === 'cash');
    expect(cashEvents).toHaveLength(1);
    expect(cashEvents[0]).toMatchObject({ type: 'cash', delta: 1000, reason: 'deposit' });
    expect(cashEvents[0]?.t.toISOString()).toBe('2024-06-03T00:00:00.000Z');

    // The cash event is emitted BEFORE the snapshot, and the snapshot reflects +1000.
    const cashIdx = events.findIndex((e) => e.type === 'cash');
    const snapIdx = events.findIndex((e) => e.type === 'snapshot');
    expect(cashIdx).toBeLessThan(snapIdx);
    const snapshot = events.find((e) => e.type === 'snapshot');
    expect(snapshot?.type === 'snapshot' && snapshot.portfolio.cash).toBe(2000);
  });

  it('drains a dynamically pushed CashEventQueue at the next session close', async () => {
    const calendar = new Crypto24x7Calendar();
    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2024-06-03T23:00:00Z', 100) },
      { asset: SPY, bar: bar('2024-06-04T01:00:00Z', 105) }, // closes day 1
    ];
    const strategy: Strategy<Features, void> = {
      universe: () => [SPY],
      features: async () => ({}),
      build: () => [],
    };
    const history: BacktestResult<void> = {
      snapshots: [],
      finalPortfolio: { cash: 1000, positions: [], t: new Date('2024-06-03T00:00:00Z') },
      finalState: undefined,
      bars: new Map(),
    };

    const queue = new CashEventQueue();
    // Pushed before draining the stream; due by the day-1 session close.
    queue.push({ t: new Date('2024-06-03T00:00:00Z'), delta: 500, reason: 'interest' });

    const events = [];
    for await (const ev of runLive({
      strategy,
      history,
      dataFeed: tickStream(ticks),
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
      cashEventQueue: queue,
    })) {
      events.push(ev);
    }

    const cashEvents = events.filter((e) => e.type === 'cash');
    expect(cashEvents).toHaveLength(1);
    expect(cashEvents[0]).toMatchObject({ type: 'cash', delta: 500, reason: 'interest' });
    const snapshot = events.find((e) => e.type === 'snapshot');
    expect(snapshot?.type === 'snapshot' && snapshot.portfolio.cash).toBe(1500);
  });

  it('sums a seeded cash event and a queued one due at the same session close', async () => {
    const calendar = new Crypto24x7Calendar();
    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2024-06-03T23:00:00Z', 100) },
      { asset: SPY, bar: bar('2024-06-04T01:00:00Z', 105) }, // closes day 1
    ];
    const strategy: Strategy<Features, void> = {
      universe: () => [SPY],
      features: async () => ({}),
      build: () => [],
    };
    const history: BacktestResult<void> = {
      snapshots: [],
      finalPortfolio: { cash: 1000, positions: [], t: new Date('2024-06-03T00:00:00Z') },
      finalState: undefined,
      bars: new Map(),
    };

    const queue = new CashEventQueue();
    queue.push({ t: new Date('2024-06-03T00:00:00Z'), delta: 250, reason: 'dividend' });

    const events = [];
    for await (const ev of runLive({
      strategy,
      history,
      dataFeed: tickStream(ticks),
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
      // Both the seed and the queued event are due by the day-1 session close.
      cashEvents: [{ t: new Date('2024-06-03T00:00:00Z'), delta: 1000, reason: 'deposit' }],
      cashEventQueue: queue,
    })) {
      events.push(ev);
    }

    const cashEvents = events.filter((e) => e.type === 'cash');
    // A SINGLE cash event with the SUMMED delta (1000 + 250).
    expect(cashEvents).toHaveLength(1);
    expect(cashEvents[0]?.type === 'cash' && cashEvents[0].delta).toBe(1250);
    const snapshot = events.find((e) => e.type === 'snapshot');
    expect(snapshot?.type === 'snapshot' && snapshot.portfolio.cash).toBe(2250);
  });

  it('does NOT emit a cash event on plain mark ticks when nothing is due', async () => {
    const calendar = new Crypto24x7Calendar();
    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2024-06-03T12:00:00Z', 100) },
      { asset: SPY, bar: bar('2024-06-03T13:00:00Z', 101) },
      { asset: SPY, bar: bar('2024-06-03T14:00:00Z', 102) },
    ];
    const strategy: Strategy<Features, void> = {
      universe: () => [SPY],
      features: async () => ({}),
      build: () => [],
    };
    const history: BacktestResult<void> = {
      snapshots: [],
      finalPortfolio: { cash: 1000, positions: [], t: new Date('2024-06-03T00:00:00Z') },
      finalState: undefined,
      bars: new Map(),
    };

    const events = [];
    for await (const ev of runLive({
      strategy,
      history,
      dataFeed: tickStream(ticks),
      executor: { submit: vi.fn().mockResolvedValue([]) },
      calendar,
      // Future-dated event — never becomes due within this stream (no boundary crossed).
      cashEvents: [{ t: new Date('2024-06-10T00:00:00Z'), delta: 1000 }],
    })) {
      events.push(ev);
    }

    // All ticks within one session: 3 marks, no snapshot, and NO cash event.
    expect(events.filter((e) => e.type === 'mark')).toHaveLength(3);
    expect(events.filter((e) => e.type === 'snapshot')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'cash')).toHaveLength(0);
  });
});
