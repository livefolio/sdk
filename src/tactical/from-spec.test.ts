import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fromSpec } from './from-spec';
import { _resetTacticalDeprecationWarningForTesting } from './from-spec';
import { FeatureRuntime } from '../features/runtime';
import { MemoryFeatureCache } from '../reference';
import { NYSEExchangeCalendar } from '../calendars';
import type { Bar } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { Portfolio } from '../portfolio/types';
import type { TacticalSpec } from './types';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const SPY_REF = { id: 'us:SPY', symbol: 'SPY' };
const range = { from: utc('2026-01-05'), to: utc('2026-01-15') };
const calendar = new NYSEExchangeCalendar();

function feedFor(closes: number[]) {
  const bars: Bar[] = closes.map((c, i) => ({
    t: utc(`2026-01-0${5 + i}`),
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
  }));
  const calls = vi.fn(async function* (_a, _r, _f) {
    for (const b of bars) yield b;
  });
  return { feed: { bars: calls } as DataFeed, calls };
}

const initialPortfolio: Portfolio = { cash: 10_000, positions: [], t: utc('2026-01-05') };

const stateless: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY_REF],
  features: [
    { id: 'price', kind: 'price', asset: SPY_REF },
    { id: 'sma', kind: 'sma', asset: SPY_REF, period: 3 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'price' }, right: { ref: 'sma' } },
    then: { op: 'allocate', weights: { 'us:SPY': 1 } },
    else: { op: 'allocate', weights: {} },
  },
};

describe('fromSpec', () => {
  it('exposes the resolved universe as v0.4 Assets', () => {
    const { feed } = feedFor([100, 101, 102, 103, 104]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const strategy = fromSpec(stateless, { runtime, calendar });
    const universe = strategy.universe(utc('2026-01-09'), initialPortfolio);
    expect(universe).toHaveLength(1);
    expect(universe[0]).toMatchObject({ kind: 'equity', id: 'us:SPY', symbol: 'SPY' });
  });

  it('builds rebalance orders when the rule branch fires', async () => {
    const { feed } = feedFor([100, 101, 102, 103, 104]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const strategy = fromSpec(stateless, { runtime, calendar });
    const t = utc('2026-01-09');
    const features = await strategy.features(strategy.universe(t, initialPortfolio), initialPortfolio, t);
    const { orders } = strategy.build(features, initialPortfolio, strategy.initialState!(), t);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0]!.kind).toBe('rebalance');
  });

  it('warmup → no orders', async () => {
    const { feed } = feedFor([100, 101, 102, 103, 104]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const strategy = fromSpec(stateless, { runtime, calendar });
    const t = utc('2026-01-05');
    const features = await strategy.features(strategy.universe(t, initialPortfolio), initialPortfolio, t);
    const { orders } = strategy.build(features, initialPortfolio, strategy.initialState!(), t);
    expect(orders).toEqual([]);
  });

  it('missing price → no orders', async () => {
    const calls = vi.fn(async function* () {});
    const feed: DataFeed = { bars: calls };
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const strategy = fromSpec(stateless, { runtime, calendar });
    const t = utc('2026-01-09');
    const features = await strategy.features(strategy.universe(t, initialPortfolio), initialPortfolio, t);
    const { orders } = strategy.build(features, initialPortfolio, strategy.initialState!(), t);
    expect(orders).toEqual([]);
  });

  it('threads hysteresis state across consecutive build calls', async () => {
    const tolerantSpec: TacticalSpec = {
      kind: 'tactical/v1',
      universe: [SPY_REF],
      features: [{ id: 'price', kind: 'price', asset: SPY_REF }],
      rules: {
        op: 'if',
        cond: {
          op: 'gt',
          left: { ref: 'price' },
          right: 100,
          tolerance: { value: 5, mode: 'absolute' },
          id: 'px_vs_100',
        },
        then: { op: 'allocate', weights: { 'us:SPY': 1 } },
        else: { op: 'allocate', weights: {} },
      },
    };

    const { feed } = feedFor([106, 96, 94]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const strategy = fromSpec(tolerantSpec, { runtime, calendar });

    const days = [utc('2026-01-05'), utc('2026-01-06'), utc('2026-01-07')];
    const ordersByDay: number[] = [];
    let state = strategy.initialState!();

    for (const t of days) {
      const features = await strategy.features(strategy.universe(t, initialPortfolio), initialPortfolio, t);
      const { orders, state: nextState } = strategy.build(features, initialPortfolio, state, t);
      state = nextState;
      ordersByDay.push(orders.length);
    }

    // Day 1: enters long → buy orders.
    expect(ordersByDay[0]!).toBeGreaterThan(0);
    // Day 2: still inside band, hysteresis keeps target={SPY:1} → buy orders against the still-empty portfolio.
    // Without state threading, day 2's raw compare (96 > 100) would be false → target={} → 0 orders.
    // So a non-zero count here is the proof that state was threaded.
    expect(ordersByDay[1]!).toBeGreaterThan(0);
    // Day 3: drops below lower band → state flips to 0 → target={} → no positions to sell → 0 orders.
    expect(ordersByDay[2]!).toBe(0);
  });

  it('rebalance Weekly skips Mon–Thu and only emits orders on Friday', async () => {
    const { feed } = feedFor([100, 105, 102, 107, 110]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const weekly: TacticalSpec = {
      ...stateless,
      rebalance: { frequency: 'Weekly' },
      features: [
        { id: 'price', kind: 'price', asset: SPY_REF },
        { id: 'sma', kind: 'sma', asset: SPY_REF, period: 2 },
      ],
    };
    const strategy = fromSpec(weekly, { runtime, calendar });

    const sessions = [utc('2026-01-05'), utc('2026-01-06'), utc('2026-01-07'), utc('2026-01-08'), utc('2026-01-09')];
    const ordersByDay: number[] = [];
    let state = strategy.initialState!();
    for (const t of sessions) {
      const features = await strategy.features(strategy.universe(t, initialPortfolio), initialPortfolio, t);
      const { orders, state: nextState } = strategy.build(features, initialPortfolio, state, t);
      state = nextState;
      ordersByDay.push(orders.length);
    }
    expect(ordersByDay.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(ordersByDay[4]!).toBeGreaterThan(0);
  });

  it('rebalance default (no field) evaluates every session', async () => {
    const { feed } = feedFor([100, 101, 102, 103, 104]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const strategy = fromSpec(stateless, { runtime, calendar });
    const t = utc('2026-01-09');
    const features = await strategy.features(strategy.universe(t, initialPortfolio), initialPortfolio, t);
    const { orders } = strategy.build(features, initialPortfolio, strategy.initialState!(), t);
    expect(orders.length).toBeGreaterThan(0);
  });

  it('honors AssetRef.kind by producing a mixed-kind universe', () => {
    const equity = { id: 'us:SPY', symbol: 'SPY' };
    const macro = { kind: 'macro' as const, id: 'DGS10', symbol: '10Y Treasury' };

    const spec: TacticalSpec = {
      kind: 'tactical/v1',
      universe: [equity, macro],
      rebalance: { frequency: 'Monthly' },
      features: [],
      rules: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    };

    const { feed } = feedFor([100, 101, 102, 103, 104]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const strategy = fromSpec(spec, { runtime, calendar });
    const universe = strategy.universe(utc('2024-06-03'), initialPortfolio);

    expect(universe).toHaveLength(2);
    expect(universe.find((a) => a.id === 'us:SPY')?.kind).toBe('equity');
    expect(universe.find((a) => a.id === 'DGS10')?.kind).toBe('macro');
  });

  it('throws on synthetic id colliding with a non-underlying universe ref', () => {
    const conflicting: TacticalSpec = {
      kind: 'tactical/v1',
      universe: [{ id: 'us:SPY_3X', symbol: 'SPY_3X' }, SPY_REF],
      synthetics: [{ id: 'us:SPY_3X', symbol: 'SPY_3X', underlying: SPY_REF, leverage: 3 }],
      features: [],
      rules: { op: 'allocate', weights: {} },
    };
    const { feed } = feedFor([100]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    expect(() => fromSpec(conflicting, { runtime, calendar })).not.toThrow();

    const ambiguous: TacticalSpec = {
      ...conflicting,
      synthetics: [{ id: 'us:SPY', symbol: 'SPY', underlying: { id: 'us:VOO', symbol: 'VOO' }, leverage: 1 }],
    };
    expect(() => fromSpec(ambiguous, { runtime, calendar })).toThrow(/synthetic asset id "us:SPY" collides/);
  });
});

describe('fromSpec state threading', () => {
  const simpleSpecWithHysteresis: TacticalSpec = {
    kind: 'tactical/v1',
    universe: [SPY_REF],
    features: [{ id: 'price', kind: 'price', asset: SPY_REF }],
    rules: {
      op: 'if',
      cond: {
        op: 'gt',
        left: { ref: 'price' },
        right: 100,
        tolerance: { value: 5, mode: 'absolute' },
        id: 'px_vs_100',
      },
      then: { op: 'allocate', weights: { 'us:SPY': 1 } },
      else: { op: 'allocate', weights: {} },
    },
  };

  it('initialState() returns an empty RuleTreeState Map', () => {
    const { feed } = feedFor([106, 96, 94]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const strategy = fromSpec(simpleSpecWithHysteresis, { runtime, calendar });
    const initial = strategy.initialState!();
    expect(initial).toBeInstanceOf(Map);
    expect(initial.size).toBe(0);
  });

  it('build is deterministic given the same state input (no hidden closure)', async () => {
    const { feed } = feedFor([106, 96, 94]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const strategy = fromSpec(simpleSpecWithHysteresis, { runtime, calendar });
    const t = utc('2026-01-05');
    const portfolio = { cash: 100_000, positions: [], t };
    const features = await strategy.features(strategy.universe(t, portfolio), portfolio, t);
    const state = strategy.initialState!();

    const r1 = strategy.build(features, portfolio, state, t);
    const r2 = strategy.build(features, portfolio, state, t);

    // If state were held in a closure and mutated by r1, r2 would differ.
    // With threaded state, both calls receive the same input and produce the same output.
    expect(r1).toEqual(r2);
  });
});

describe('tactical/v0 deprecation warning', () => {
  beforeEach(() => {
    _resetTacticalDeprecationWarningForTesting();
  });

  it('accepts tactical/v0 with a one-time deprecation warning', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spec: TacticalSpec = {
      kind: 'tactical/v0',
      universe: [SPY_REF],
      features: [{ id: 'p', kind: 'price', asset: SPY_REF }],
      rules: { op: 'allocate', weights: { 'us:SPY': 1 } },
    };
    const { feed } = feedFor([100, 101, 102]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const opts = { runtime, calendar };
    fromSpec(spec, opts);
    fromSpec(spec, opts);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatch(/tactical\/v0 is deprecated/);
    spy.mockRestore();
  });

  it('accepts tactical/v1 without a warning', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spec: TacticalSpec = {
      kind: 'tactical/v1',
      universe: [SPY_REF],
      features: [{ id: 'p', kind: 'price', asset: SPY_REF }],
      rules: { op: 'allocate', weights: { 'us:SPY': 1 } },
    };
    const { feed } = feedFor([100, 101, 102]);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    fromSpec(spec, { runtime, calendar });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
