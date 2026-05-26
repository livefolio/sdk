import { describe, it, expect, vi } from 'vitest';
import { runBacktest } from './run-backtest';
import { NYSEExchangeCalendar } from '../calendars';
import { FeatureRuntime } from '../features/runtime';
import { MemoryFeatureCache } from '../reference/memory-feature-cache';
import type { Strategy, Features } from './types';
import type { Asset, Bar, DividendEvent } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { Executor } from '../interfaces/executor';
import type { Order, Fill } from '../orders/types';
import type { Portfolio, Lot } from '../portfolio/types';

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

describe('runBacktest cashEvents', () => {
  const range = { from: new Date('2024-01-02'), to: new Date('2024-01-09') };
  // NYSE sessions in this range: Jan 2, 3, 4, 5, 8 (5 sessions)
  const simpleStrategy: Strategy = {
    universe: () => [],
    features: async () => ({}),
    build: () => [],
  };
  const dataFeed: DataFeed = { bars: vi.fn().mockImplementation(async function* () {}) };
  const executor: Executor = { submit: vi.fn().mockResolvedValue([]) };
  const calendar = new NYSEExchangeCalendar();

  it('applies a cashEvent on the matching session (3rd session) and records cashFlow', async () => {
    // Jan 4 is the 3rd NYSE session (Jan 2, Jan 3, Jan 4)
    const result = await runBacktest({
      strategy: simpleStrategy,
      range,
      initialPortfolio: { cash: 10_000, positions: [] },
      dataFeed,
      executor,
      calendar,
      cashEvents: [{ t: new Date('2024-01-04'), delta: 1000 }],
    });

    expect(result.snapshots).toHaveLength(5);

    // Sessions 1 and 2 should have no cashFlow
    expect(result.snapshots[0]!.cashFlow).toBeUndefined();
    expect(result.snapshots[1]!.cashFlow).toBeUndefined();

    // Session 3 (Jan 4) should have cashFlow === 1000
    expect(result.snapshots[2]!.cashFlow).toBe(1000);
    // Portfolio cash at session 3 should reflect the deposit (no fills, so cash = 10_000 + 1000)
    expect(result.snapshots[2]!.portfolio.cash).toBe(11_000);

    // Sessions 4 and 5 should have no cashFlow
    expect(result.snapshots[3]!.cashFlow).toBeUndefined();
    expect(result.snapshots[4]!.cashFlow).toBeUndefined();
  });

  it('cashFlow is undefined on every snapshot when no cashEvents are passed (parity-safety guard)', async () => {
    const result = await runBacktest({
      strategy: simpleStrategy,
      range,
      initialPortfolio: { cash: 10_000, positions: [] },
      dataFeed,
      executor,
      calendar,
    });

    for (const snap of result.snapshots) {
      expect(snap.cashFlow).toBeUndefined();
    }
  });

  it('sums multiple cashEvents due on the same session', async () => {
    const result = await runBacktest({
      strategy: simpleStrategy,
      range,
      initialPortfolio: { cash: 10_000, positions: [] },
      dataFeed,
      executor,
      calendar,
      cashEvents: [
        { t: new Date('2024-01-04'), delta: 500 },
        { t: new Date('2024-01-04'), delta: 300 },
      ],
    });

    expect(result.snapshots[2]!.cashFlow).toBe(800);
    expect(result.snapshots[2]!.portfolio.cash).toBe(10_800);
  });

  it('applies events with t before first session on session 1', async () => {
    const result = await runBacktest({
      strategy: simpleStrategy,
      range,
      initialPortfolio: { cash: 10_000, positions: [] },
      dataFeed,
      executor,
      calendar,
      cashEvents: [{ t: new Date('2023-12-31'), delta: 2000 }],
    });

    expect(result.snapshots[0]!.cashFlow).toBe(2000);
    expect(result.snapshots[0]!.portfolio.cash).toBe(12_000);
    expect(result.snapshots[1]!.cashFlow).toBeUndefined();
  });

  it('does not apply events with t after last session', async () => {
    const result = await runBacktest({
      strategy: simpleStrategy,
      range,
      initialPortfolio: { cash: 10_000, positions: [] },
      dataFeed,
      executor,
      calendar,
      cashEvents: [{ t: new Date('2024-01-15'), delta: 9999 }],
    });

    for (const snap of result.snapshots) {
      expect(snap.cashFlow).toBeUndefined();
    }
    expect(result.finalPortfolio.cash).toBe(10_000);
  });
});

describe('runBacktest dividend hook', () => {
  const calendar = new NYSEExchangeCalendar();
  // NYSE sessions in this range: Jan 2, 3, 4, 5, 8 (5 sessions). Ex-date = Jan 4 (3rd session).
  const range = { from: new Date('2024-01-02'), to: new Date('2024-01-09') };
  const exDate = new Date('2024-01-04');
  const payDate = new Date('2024-01-08');

  const heldLot: Lot = {
    id: 'lot_held',
    asset: SPY,
    quantity: 100,
    openDate: new Date('2023-01-01'), // long-held → qualifies for the 60-of-121 test
    openPrice: 50,
    basis: 5000,
  };

  const portfolioWithLot: Portfolio = {
    cash: 10_000,
    positions: [],
    lots: [heldLot],
    realized: [],
    t: new Date('2024-01-02T00:00:00Z'),
  };

  // Trivial strategy: universe = [SPY], no orders, isolates the dividend hook.
  const strategy: Strategy = {
    universe: () => [SPY],
    features: async () => ({}),
    build: () => [],
  };

  const makeFeed = (event: DividendEvent, payClose = 200): DataFeed => ({
    bars: async function* (_asset, _r, _freq, kind) {
      // Only the unadjusted pay-date close matters for DRIP.
      if (kind === 'unadjusted') {
        yield {
          t: payDate,
          open: payClose,
          high: payClose,
          low: payClose,
          close: payClose,
          volume: 0,
        };
      }
    },
    dividends: async () => [event],
  });

  const executor: Executor = { submit: async () => [] };

  it('(a) cash mode credits cash and appends a RealizedEvent', async () => {
    const event: DividendEvent = {
      asset: SPY,
      exDate,
      payDate,
      amountPerShare: 1.5,
      incomeKind: 'qualified-eligible',
    };
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: portfolioWithLot,
      dataFeed: makeFeed(event),
      executor,
      calendar,
      dividends: { reinvest: false },
    });

    // Ex-date is the 3rd session (Jan 4).
    const exSnap = result.snapshots[2]!;
    expect(exSnap.dividendIncome).toEqual({ qualified: 150, ordinary: 0 });

    // 100 shares * 1.5 = 150 credited to cash.
    expect(result.finalPortfolio.cash).toBe(10_150);

    const realized = result.finalPortfolio.realized ?? [];
    expect(realized).toHaveLength(1);
    expect(realized[0]).toMatchObject({
      lotId: 'lot_held',
      quantity: 0,
      basis: 0,
      proceeds: 150,
      gain: 150,
      incomeKind: 'qualified-dividend',
      termType: 'long',
    });

    // No DRIP lot was created (still just the original lot).
    expect(result.finalPortfolio.lots).toHaveLength(1);
  });

  it('cash mode is the default when dividends config is omitted (feed still drives it)', async () => {
    const event: DividendEvent = {
      asset: SPY,
      exDate,
      payDate,
      amountPerShare: 2,
      incomeKind: 'ordinary',
    };
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: portfolioWithLot,
      dataFeed: makeFeed(event),
      executor,
      calendar,
      // dividends omitted → reinvest defaults false (cash mode)
    });

    expect(result.snapshots[2]!.dividendIncome).toEqual({ qualified: 0, ordinary: 200 });
    expect(result.finalPortfolio.cash).toBe(10_200);
    expect(result.finalPortfolio.lots).toHaveLength(1);
  });

  it('(b) DRIP mode reinvests into a new lot at the unadjusted pay-date close', async () => {
    const payClose = 200;
    const event: DividendEvent = {
      asset: SPY,
      exDate,
      payDate,
      amountPerShare: 1.5,
      incomeKind: 'qualified-eligible',
    };
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: portfolioWithLot,
      dataFeed: makeFeed(event, payClose),
      executor,
      calendar,
      dividends: { reinvest: true },
    });

    // cash = 100 * 1.5 = 150; floor(150 / 200) = 0 shares affordable, so DRIP buys
    // nothing and the full 150 falls back as residual cash.
    expect(result.finalPortfolio.cash).toBe(10_150);
    // No lot added because quantity === 0.
    expect(result.finalPortfolio.lots).toHaveLength(1);
  });

  it('(b) DRIP mode adds a lot with dripParent when a whole share is affordable', async () => {
    const payClose = 50; // 150 cash / 50 = 3 shares, residual 0
    const event: DividendEvent = {
      asset: SPY,
      exDate,
      payDate,
      amountPerShare: 1.5,
      incomeKind: 'qualified-eligible',
    };
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: portfolioWithLot,
      dataFeed: makeFeed(event, payClose),
      executor,
      calendar,
      dividends: { reinvest: true },
    });

    const lots = result.finalPortfolio.lots ?? [];
    expect(lots).toHaveLength(2);
    const dripLot = lots.find((l) => l.dripParent === 'lot_held');
    expect(dripLot).toBeDefined();
    expect(dripLot!.quantity).toBe(Math.floor(150 / payClose)); // 3
    expect(dripLot!.openPrice).toBe(payClose);
    // residual = 150 - 3*50 = 0 → cash unchanged.
    expect(result.finalPortfolio.cash).toBe(10_000);
    // Still records dividend income.
    expect(result.snapshots[2]!.dividendIncome).toEqual({ qualified: 150, ordinary: 0 });
  });

  it('(c) ordinary dividend lands in dividendIncome.ordinary; qualified-eligible (long-held) in .qualified', async () => {
    const ordinaryEvent: DividendEvent = {
      asset: SPY,
      exDate,
      payDate,
      amountPerShare: 1,
      incomeKind: 'ordinary',
    };
    const ordResult = await runBacktest({
      strategy,
      range,
      initialPortfolio: portfolioWithLot,
      dataFeed: makeFeed(ordinaryEvent),
      executor,
      calendar,
    });
    expect(ordResult.snapshots[2]!.dividendIncome).toEqual({ qualified: 0, ordinary: 100 });
    expect(ordResult.finalPortfolio.realized?.[0]?.incomeKind).toBe('ordinary-dividend');
  });

  it('does not set dividendIncome on sessions without a matching ex-date', async () => {
    const event: DividendEvent = {
      asset: SPY,
      exDate,
      payDate,
      amountPerShare: 1.5,
      incomeKind: 'qualified-eligible',
    };
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: portfolioWithLot,
      dataFeed: makeFeed(event),
      executor,
      calendar,
    });
    expect(result.snapshots[0]!.dividendIncome).toBeUndefined();
    expect(result.snapshots[1]!.dividendIncome).toBeUndefined();
    expect(result.snapshots[2]!.dividendIncome).toBeDefined();
    expect(result.snapshots[3]!.dividendIncome).toBeUndefined();
  });

  it('is inert when the feed has no dividends() (parity-safety guard)', async () => {
    const feed: DataFeed = { bars: async function* () {} };
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: portfolioWithLot,
      dataFeed: feed,
      executor,
      calendar,
    });
    for (const snap of result.snapshots) {
      expect(snap.dividendIncome).toBeUndefined();
    }
    expect(result.finalPortfolio.cash).toBe(10_000);
  });
});

describe('runBacktest cashYield (interest accrual)', () => {
  const calendar = new NYSEExchangeCalendar();
  // ~1 trading year of NYSE sessions.
  const range = { from: new Date('2024-01-01'), to: new Date('2024-12-31') };

  const strategy: Strategy = {
    universe: () => [SPY],
    features: async () => ({}),
    build: () => [],
  };
  const emptyFeed: DataFeed = { bars: async function* () {} };
  const executor: Executor = { submit: async () => [] };

  const cashOnly: Portfolio = {
    cash: 10_000,
    positions: [],
    lots: [],
    realized: [],
    t: new Date('2024-01-01T00:00:00Z'),
  };

  it('flat: accrues daily interest, credits cash, and reports interestIncome', async () => {
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: cashOnly,
      dataFeed: emptyFeed,
      executor,
      calendar,
      cashYield: { kind: 'flat', apy: 0.05 },
    });

    // First session: interest on the starting balance at apy/365.
    const first = result.snapshots[0]!;
    expect(first.interestIncome).toBeDefined();
    expect(first.interestIncome!).toBeCloseTo((10_000 * 0.05) / 365, 6);

    // Interest accrues only on trading sessions (~252 NYSE days/yr) at apy/365,
    // so cumulative over a calendar year ≈ 10_000 * 0.05 * (252/365) ≈ $345.
    const cumulative = result.snapshots.reduce((sum, s) => sum + (s.interestIncome ?? 0), 0);
    expect(cumulative).toBeGreaterThan(330);
    expect(cumulative).toBeLessThan(360);
    // Final cash reflects the accrued interest.
    expect(result.finalPortfolio.cash).toBeCloseTo(10_000 + cumulative, 6);

    // At least one snapshot carries an `interest` RealizedEvent with basis 0.
    const interestEvents = (result.finalPortfolio.realized ?? []).filter(
      (r) => r.incomeKind === 'interest',
    );
    expect(interestEvents.length).toBeGreaterThan(0);
    expect(interestEvents[0]).toMatchObject({
      incomeKind: 'interest',
      basis: 0,
      termType: 'short',
      lotId: 'cash',
      quantity: 0,
    });
    expect(interestEvents[0]!.gain).toBe(interestEvents[0]!.proceeds);
    expect(interestEvents[0]!.asset.symbol).toBe('CASH');
  });

  it('default (no cashYield) is inert: no interestIncome, no interest events', async () => {
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: cashOnly,
      dataFeed: emptyFeed,
      executor,
      calendar,
    });
    for (const snap of result.snapshots) {
      expect(snap.interestIncome).toBeUndefined();
    }
    expect((result.finalPortfolio.realized ?? []).some((r) => r.incomeKind === 'interest')).toBe(
      false,
    );
    expect(result.finalPortfolio.cash).toBe(10_000);
  });

  it("kind 'none' is inert (parity-safe)", async () => {
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: cashOnly,
      dataFeed: emptyFeed,
      executor,
      calendar,
      cashYield: { kind: 'none' },
    });
    for (const snap of result.snapshots) {
      expect(snap.interestIncome).toBeUndefined();
    }
    expect((result.finalPortfolio.realized ?? []).some((r) => r.incomeKind === 'interest')).toBe(
      false,
    );
  });

  it('does not accrue when cash <= 0', async () => {
    const broke: Portfolio = {
      cash: 0,
      positions: [],
      lots: [],
      realized: [],
      t: new Date('2024-01-01T00:00:00Z'),
    };
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: broke,
      dataFeed: emptyFeed,
      executor,
      calendar,
      cashYield: { kind: 'flat', apy: 0.05 },
    });
    for (const snap of result.snapshots) {
      expect(snap.interestIncome).toBeUndefined();
    }
    expect((result.finalPortfolio.realized ?? []).some((r) => r.incomeKind === 'interest')).toBe(
      false,
    );
  });

  it('tbill: derives the daily rate from a macro yield series close', async () => {
    const macroClose = 5.0; // FRED percentage → 5%
    const spread = 0.001;
    const macroFeed: DataFeed = {
      bars: async function* (asset) {
        // Only the macro series drives the rate; SPY (and others) yield nothing.
        if (asset.kind === 'macro') {
          yield { t: new Date('2024-01-02'), open: macroClose, high: macroClose, low: macroClose, close: macroClose, volume: 0 };
        }
      },
    };
    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio: cashOnly,
      dataFeed: macroFeed,
      executor,
      calendar,
      cashYield: { kind: 'tbill', spread },
    });

    const expectedDaily = (macroClose / 100 - spread) / 365;
    const first = result.snapshots[0]!;
    expect(first.interestIncome).toBeDefined();
    expect(first.interestIncome!).toBeCloseTo(10_000 * expectedDaily, 6);
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
