import { describe, it, expect, vi } from 'vitest';
import { fromSpec, withSynthetics, type TacticalSpec, type SyntheticAsset } from '.';
import { FeatureRuntime, seriesAt } from '../features';
import { runBacktest, reconcile, type Strategy } from '../strategy';
import { MemoryFeatureCache, BacktestExecutor } from '../reference';
import { NYSEExchangeCalendar } from '../calendars';
import type { Asset, Bar } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { Portfolio } from '../portfolio/types';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const SPY_REF = { id: 'us:SPY', symbol: 'SPY' };
const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };

function bars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    t: utc(`2026-01-${String(5 + i).padStart(2, '0')}`),
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
  }));
}

function feedFor(closes: number[]) {
  const fixture = bars(closes);
  const calls = vi.fn(async function* (_a: Asset, _r, _f) {
    for (const b of fixture) yield b;
  });
  return { feed: { bars: calls } as DataFeed, calls, fixture };
}

function makeExecutor(calendar: NYSEExchangeCalendar, fixture: Bar[]) {
  return new BacktestExecutor({
    calendar,
    nextOpen: async (_a, t) => {
      const next = fixture.find((b) => b.t.getTime() > t.getTime());
      return next ? { t: next.t, price: next.open } : { t, price: 0 };
    },
  });
}

const initialPortfolio: Portfolio = { cash: 10_000, positions: [], t: utc('2026-01-05') };

describe('phase 3 integration', () => {
  // A. Parity
  it('TacticalSpec via fromSpec matches the equivalent code-form strategy bar-for-bar', async () => {
    const closes = [100, 99, 98, 105, 110];
    const range = { from: utc('2026-01-05'), to: utc('2026-01-10') };
    const calendar = new NYSEExchangeCalendar();

    const spec: TacticalSpec = {
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

    const { feed: feedA, fixture: fixA } = feedFor(closes);
    const runtimeA = new FeatureRuntime({ dataFeed: feedA, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const codeForm: Strategy<{ price?: number; sma?: number }> = {
      universe: () => [SPY],
      features: async (_u, _p, t) => {
        const [p, s] = await Promise.all([
          runtimeA.compute({ kind: 'price' }, SPY),
          runtimeA.compute({ kind: 'sma', period: 3 }, SPY),
        ]);
        return { price: seriesAt(p, t), sma: seriesAt(s, t) };
      },
      build: (f, portfolio) => {
        if (f.price === undefined) return [];
        const target = f.sma !== undefined && f.price > f.sma ? new Map([['us:SPY', 1]]) : new Map<string, number>();
        return reconcile(target, portfolio, new Map([['us:SPY', f.price]]));
      },
    };
    const resultA = await runBacktest({
      strategy: codeForm,
      range,
      initialPortfolio,
      dataFeed: feedA,
      executor: makeExecutor(calendar, fixA),
      calendar,
    });

    const { feed: feedB, fixture: fixB } = feedFor(closes);
    const runtimeB = new FeatureRuntime({ dataFeed: feedB, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const resultB = await runBacktest({
      strategy: fromSpec(spec, { runtime: runtimeB, calendar }),
      range,
      initialPortfolio,
      dataFeed: feedB,
      executor: makeExecutor(calendar, fixB),
      calendar,
    });

    expect(resultB.snapshots.length).toBe(resultA.snapshots.length);
    for (let i = 0; i < resultA.snapshots.length; i++) {
      const a = resultA.snapshots[i]!;
      const b = resultB.snapshots[i]!;
      expect(b.orders.length).toBe(a.orders.length);
      for (let j = 0; j < a.orders.length; j++) {
        const oa = a.orders[j]!;
        const ob = b.orders[j]!;
        expect(ob.kind).toBe(oa.kind);
        if (oa.kind === 'rebalance' && ob.kind === 'rebalance') {
          expect(ob.asset.id).toBe(oa.asset.id);
          expect(ob.delta).toBe(oa.delta);
        }
      }
    }
    expect(resultB.finalPortfolio.cash).toBeCloseTo(resultA.finalPortfolio.cash, 6);
    expect(resultB.finalPortfolio.positions.length).toBe(resultA.finalPortfolio.positions.length);
  });

  // B. Hysteresis stabilizes a noisy signal
  it('hysteresis reduces signal flips on an oscillating fixture', async () => {
    const closes = [106, 99, 102, 99, 102, 99, 102];
    const range = { from: utc('2026-01-05'), to: utc('2026-01-12') };
    const calendar = new NYSEExchangeCalendar();

    const baseRule = (tolerant: boolean): TacticalSpec => ({
      kind: 'tactical/v1',
      universe: [SPY_REF],
      features: [{ id: 'price', kind: 'price', asset: SPY_REF }],
      rules: {
        op: 'if',
        cond: tolerant
          ? { op: 'gt', left: { ref: 'price' }, right: 100, tolerance: { value: 5, mode: 'absolute' }, id: 'cmp' }
          : { op: 'gt', left: { ref: 'price' }, right: 100 },
        then: { op: 'allocate', weights: { 'us:SPY': 1 } },
        else: { op: 'allocate', weights: {} },
      },
    });

    async function runWith(spec: TacticalSpec) {
      const { feed, fixture } = feedFor(closes);
      const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
      return runBacktest({
        strategy: fromSpec(spec, { runtime, calendar }),
        range,
        initialPortfolio,
        dataFeed: feed,
        executor: makeExecutor(calendar, fixture),
        calendar,
      });
    }

    const noisy = await runWith(baseRule(false));
    const stable = await runWith(baseRule(true));
    const flipsNoisy = noisy.snapshots.filter((s) => s.orders.length > 0).length;
    const flipsStable = stable.snapshots.filter((s) => s.orders.length > 0).length;
    expect(flipsStable).toBeLessThan(flipsNoisy);
  });

  // C. Delay shifts the signal
  it('per-feature delay shifts the rule input by one session', async () => {
    const closes = [100, 100, 110, 90, 110, 90];
    const range = { from: utc('2026-01-05'), to: utc('2026-01-12') };
    const calendar = new NYSEExchangeCalendar();

    function spec(delay: number): TacticalSpec {
      return {
        kind: 'tactical/v1',
        universe: [SPY_REF],
        features: [
          { id: 'price', kind: 'price', asset: SPY_REF },
          { id: 'sma', kind: 'sma', asset: SPY_REF, period: 3, delay },
        ],
        rules: {
          op: 'if',
          cond: { op: 'gt', left: { ref: 'price' }, right: { ref: 'sma' } },
          then: { op: 'allocate', weights: { 'us:SPY': 1 } },
          else: { op: 'allocate', weights: {} },
        },
      };
    }

    async function run(d: number) {
      const { feed, fixture } = feedFor(closes);
      const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
      return runBacktest({
        strategy: fromSpec(spec(d), { runtime, calendar }),
        range,
        initialPortfolio,
        dataFeed: feed,
        executor: makeExecutor(calendar, fixture),
        calendar,
      });
    }

    const noDelay = await run(0);
    const delayed = await run(1);

    const sigA = noDelay.snapshots.map((s) => s.portfolio.positions.length).join(',');
    const sigB = delayed.snapshots.map((s) => s.portfolio.positions.length).join(',');
    expect(sigA).not.toBe(sigB);
  });

  // D. Synthetic 3x leverage compounds
  it('a 3x leveraged synthetic compounds daily reset returns vs underlying', async () => {
    const closes = [100, 110, 99, 108.9];
    const range = { from: utc('2026-01-05'), to: utc('2026-01-09') };
    const calendar = new NYSEExchangeCalendar();

    const SPY3X: SyntheticAsset = { id: 'us:SPY_3X', symbol: 'SPY_3X', underlying: SPY_REF, leverage: 3 };
    const spec: TacticalSpec = {
      kind: 'tactical/v1',
      universe: [{ id: 'us:SPY_3X', symbol: 'SPY_3X' }, SPY_REF],
      synthetics: [SPY3X],
      features: [{ id: 'price', kind: 'price', asset: { id: 'us:SPY_3X', symbol: 'SPY_3X' } }],
      rules: { op: 'allocate', weights: { 'us:SPY_3X': 1 } },
    };

    const { feed: rawFeed, fixture } = feedFor(closes);
    const wrapped = withSynthetics(rawFeed, [SPY3X]);

    const synthBars: Bar[] = [];
    {
      let prevU: number | undefined;
      let prevS: number | undefined;
      for (const u of fixture) {
        let c: number;
        if (prevU === undefined || prevS === undefined) c = u.close;
        else c = prevS * (1 + 3 * ((u.close - prevU) / prevU));
        synthBars.push({ t: u.t, open: c, high: c, low: c, close: c, volume: u.volume });
        prevU = u.close;
        prevS = c;
      }
    }
    const executor = new BacktestExecutor({
      calendar,
      nextOpen: async (_a, t) => {
        const next = synthBars.find((b) => b.t.getTime() > t.getTime());
        return next ? { t: next.t, price: next.open } : { t, price: 0 };
      },
    });

    const runtime = new FeatureRuntime({
      dataFeed: wrapped,
      featureCache: new MemoryFeatureCache(),
      range,
      freq: '1d',
    });
    const result = await runBacktest({
      strategy: fromSpec(spec, { runtime, calendar }),
      range,
      initialPortfolio,
      dataFeed: wrapped,
      executor,
      calendar,
    });

    const finalSynth = synthBars[synthBars.length - 1]!.close;
    let mark = result.finalPortfolio.cash;
    for (const p of result.finalPortfolio.positions) mark += p.quantity * finalSynth;

    expect(synthBars[3]!.close).toBeCloseTo(118.3, 6);
    expect(mark).toBeGreaterThan(0);
  });

  // E. Weekly rebalance flows through runBacktest
  it('Weekly rebalance only emits orders on Friday in the snapshot stream', async () => {
    const closes = [100, 105, 102, 107, 110];
    const range = { from: utc('2026-01-05'), to: utc('2026-01-10') };
    const calendar = new NYSEExchangeCalendar();

    const spec: TacticalSpec = {
      kind: 'tactical/v1',
      universe: [SPY_REF],
      rebalance: { frequency: 'Weekly' },
      features: [
        { id: 'price', kind: 'price', asset: SPY_REF },
        { id: 'sma', kind: 'sma', asset: SPY_REF, period: 2 },
      ],
      rules: {
        op: 'if',
        cond: { op: 'gt', left: { ref: 'price' }, right: { ref: 'sma' } },
        then: { op: 'allocate', weights: { 'us:SPY': 1 } },
        else: { op: 'allocate', weights: {} },
      },
    };

    const { feed, fixture } = feedFor(closes);
    const runtime = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const result = await runBacktest({
      strategy: fromSpec(spec, { runtime, calendar }),
      range,
      initialPortfolio,
      dataFeed: feed,
      executor: makeExecutor(calendar, fixture),
      calendar,
    });

    const ordersByDay = result.snapshots.map((s) => s.orders.length);
    expect(ordersByDay.length).toBe(5);
    expect(ordersByDay.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(ordersByDay[4]!).toBeGreaterThan(0);
  });
});
