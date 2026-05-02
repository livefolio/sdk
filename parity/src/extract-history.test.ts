import { describe, it, expect } from 'vitest';
import { FeatureRuntime } from '@livefolio/sdk/features';
import { USEquityCalendar, MemoryFeatureCache } from '@livefolio/sdk/reference';
import type { Bar, DateRange, Frequency } from '@livefolio/sdk/interfaces';
import type { TacticalSpec } from '@livefolio/sdk/tactical';
import { YfinanceDataFeed } from '@livefolio/datafeed-yfinance';
import { extractV3History, extractV4History, extractV4TargetHistory } from './extract-history';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

describe('extractV3History', () => {
  it('emits one entry per bar with weights from allocation.holdings', () => {
    const tk = (symbol: string) => ({ symbol, leverage: 1 }) as never;
    const bars = [
      { date: '2024-01-02', allocation: { holdings: [[tk('SPY'), 1.0]] } as never },
      {
        date: '2024-01-03',
        allocation: {
          holdings: [
            [tk('SPY'), 0.6],
            [tk('QQQ'), 0.4],
          ],
        } as never,
      },
    ];
    const hist = extractV3History(bars);
    expect(hist).toEqual([
      { date: '2024-01-02', weights: { 'us:SPY': 1.0 } },
      { date: '2024-01-03', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
    ]);
  });

  it('drops CASHX', () => {
    const tk = (symbol: string) => ({ symbol, leverage: 1 }) as never;
    const bars = [
      {
        date: '2024-01-02',
        allocation: {
          holdings: [
            [tk('SPY'), 0.7],
            [tk('CASHX'), 0.3],
          ],
        } as never,
      },
    ];
    const hist = extractV3History(bars);
    expect(hist[0]!.weights).toEqual({ 'us:SPY': 1.0 }); // 0.7 renormalized to 1.0 after dropping cash
  });

  it('honors custom symbolToAssetId', () => {
    const tk = (symbol: string) => ({ symbol, leverage: 1 }) as never;
    const bars = [{ date: '2024-01-02', allocation: { holdings: [[tk('SPY'), 1.0]] } as never }];
    const hist = extractV3History(bars, (s) => `nasdaq:${s}`);
    expect(hist[0]!.weights).toEqual({ 'nasdaq:SPY': 1.0 });
  });
});

describe('extractV4History', () => {
  it('computes target weights from positions × close price, normalized', () => {
    const result = {
      snapshots: [
        {
          t: utc('2024-01-02'),
          portfolio: {
            cash: 0,
            t: utc('2024-01-02'),
            positions: [
              {
                id: 'p1',
                asset: { kind: 'equity', id: 'us:SPY', symbol: 'SPY' },
                side: 'long',
                quantity: 60,
                basis: 6_000,
                entry: { date: utc('2024-01-02'), price: 100 },
              },
              {
                id: 'p2',
                asset: { kind: 'equity', id: 'us:QQQ', symbol: 'QQQ' },
                side: 'long',
                quantity: 40,
                basis: 4_000,
                entry: { date: utc('2024-01-02'), price: 100 },
              },
            ],
          },
          orders: [],
          fills: [],
        },
      ],
      finalPortfolio: { cash: 0, positions: [], t: utc('2024-01-02') },
    } as never;
    const priceAt = () => 100;
    const hist = extractV4History(result, priceAt);
    expect(hist[0]!.date).toBe('2024-01-02');
    expect(hist[0]!.weights['us:SPY']).toBeCloseTo(0.6, 8);
    expect(hist[0]!.weights['us:QQQ']).toBeCloseTo(0.4, 8);
  });

  it('emits empty weights when portfolio is all-cash', () => {
    const result = {
      snapshots: [
        {
          t: utc('2024-01-02'),
          portfolio: { cash: 100_000, t: utc('2024-01-02'), positions: [] },
          orders: [],
          fills: [],
        },
      ],
      finalPortfolio: { cash: 100_000, positions: [], t: utc('2024-01-02') },
    } as never;
    const hist = extractV4History(result, () => 100);
    expect(hist[0]!.weights).toEqual({});
  });
});

describe('extractV4TargetHistory', () => {
  // Build a tiny synthetic SPY price series and run a price-vs-SMA-3 spec.
  // The point is to verify: (a) targets come from the rule tree (not the
  // portfolio), and (b) targets carry forward on non-rebalance days, and
  // (c) warmup days emit empty weights.
  function makeBars(prices: number[]): Bar[] {
    return prices.map((p, i) => ({
      t: utc(`2024-01-${String(i + 1).padStart(2, '0')}`),
      open: p,
      high: p,
      low: p,
      close: p,
      volume: 1_000,
    }));
  }

  const SPY_REF = { id: 'us:SPY', symbol: 'SPY' } as const;

  const SPEC: TacticalSpec = {
    kind: 'tactical/v1',
    universe: [SPY_REF],
    rebalance: { frequency: 'Daily' }, // every session is a rebalance day
    features: [
      { id: 'spy_price', kind: 'price', asset: SPY_REF },
      { id: 'spy_sma3', kind: 'sma', asset: SPY_REF, period: 3 },
    ],
    rules: {
      op: 'if',
      cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma3' } },
      then: { op: 'allocate', weights: { 'us:SPY': 1 } },
      else: { op: 'allocate', weights: {} },
    },
  };

  function buildRuntime(bars: Bar[]) {
    const dataFeed = new YfinanceDataFeed({
      fetcher: async (
        _symbol: string,
        range: DateRange,
        _freq: Frequency,
        _opts: { includeIncompleteToday: boolean },
      ) => bars.filter((b) => b.t >= range.from && b.t < range.to),
    });
    const runtime = new FeatureRuntime({
      dataFeed,
      featureCache: new MemoryFeatureCache(),
      range: { from: utc('2024-01-01'), to: utc('2024-01-15') },
      freq: '1d',
    });
    return runtime;
  }

  it('emits TARGET weights from the rule tree (not portfolio positions)', async () => {
    const bars = makeBars([100, 101, 102, 103, 104, 105, 106]); // monotonically rising → trend always up after warmup
    const runtime = buildRuntime(bars);
    const result = {
      snapshots: bars.map((b) => ({
        t: b.t,
        // Portfolio is intentionally empty — the extractor must NOT depend on it.
        portfolio: { cash: 100_000, t: b.t, positions: [] },
        orders: [],
        fills: [],
      })),
      finalPortfolio: { cash: 100_000, positions: [], t: bars.at(-1)!.t },
    } as never;

    const hist = await extractV4TargetHistory({
      result,
      spec: SPEC,
      runtime,
      calendar: new USEquityCalendar(),
    });

    expect(hist).toHaveLength(7);
    // First two days: SMA3 is undefined (warmup) → empty weights
    expect(hist[0]!.weights).toEqual({});
    expect(hist[1]!.weights).toEqual({});
    // Day 3 onwards: SMA3 is defined and trend is up → 100% SPY target
    expect(hist[2]!.weights).toEqual({ 'us:SPY': 1 });
    expect(hist[6]!.weights).toEqual({ 'us:SPY': 1 });
  });

  it('carries forward target on non-rebalance days (Weekly cadence)', async () => {
    // Use Jan 2024 trading days. Weekly rebalances happen on Fridays.
    // Mon 2024-01-01 was a market holiday in the real world but our synthetic
    // bars treat it as a session — the calendar drives rebalance detection.
    const bars: Bar[] = [
      // Build prices high-then-flat so the trend flips between weeks.
      { t: utc('2024-01-02'), open: 100, high: 100, low: 100, close: 100, volume: 1 }, // Tue
      { t: utc('2024-01-03'), open: 100, high: 100, low: 100, close: 100, volume: 1 }, // Wed
      { t: utc('2024-01-04'), open: 100, high: 100, low: 100, close: 100, volume: 1 }, // Thu
      { t: utc('2024-01-05'), open: 200, high: 200, low: 200, close: 200, volume: 1 }, // Fri (last day of ISO week 1) → rebalance
      { t: utc('2024-01-08'), open: 50, high: 50, low: 50, close: 50, volume: 1 }, // Mon (NOT rebalance)
      { t: utc('2024-01-09'), open: 50, high: 50, low: 50, close: 50, volume: 1 }, // Tue (NOT rebalance)
    ];
    const runtime = buildRuntime(bars);
    const result = {
      snapshots: bars.map((b) => ({
        t: b.t,
        portfolio: { cash: 100_000, t: b.t, positions: [] },
        orders: [],
        fills: [],
      })),
      finalPortfolio: { cash: 100_000, positions: [], t: bars.at(-1)!.t },
    } as never;

    const weeklySpec: TacticalSpec = { ...SPEC, rebalance: { frequency: 'Weekly' } };
    const hist = await extractV4TargetHistory({
      result,
      spec: weeklySpec,
      runtime,
      calendar: new USEquityCalendar(),
    });

    // Tue/Wed/Thu Jan 2-4: not rebalance days, no prior target → empty
    expect(hist[0]!.weights).toEqual({});
    expect(hist[1]!.weights).toEqual({});
    expect(hist[2]!.weights).toEqual({});
    // Fri Jan 5: rebalance day, price 200 > SMA3 ~133 → target SPY=1
    expect(hist[3]!.weights).toEqual({ 'us:SPY': 1 });
    // Mon/Tue Jan 8-9: not rebalance days, target is carried forward (NOT
    // recomputed from the new prices, even though prices crashed to 50)
    expect(hist[4]!.weights).toEqual({ 'us:SPY': 1 });
    expect(hist[5]!.weights).toEqual({ 'us:SPY': 1 });
  });
});
