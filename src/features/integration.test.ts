import { describe, it, expect, vi } from 'vitest';
import { FeatureRuntime, seriesAt } from '.';
import { runBacktest, reconcile, type Strategy } from '../strategy';
import { USEquityCalendar, MemoryFeatureCache, BacktestExecutor } from '../reference';
import type { Portfolio } from '../portfolio';
import type { Asset, Bar } from '../interfaces';
import type { DataFeed } from '../interfaces';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };

// 5 sessions: prices 100, 99, 98, 105, 110. SMA-3 trips upward at session 4.
const fixtureBars: Bar[] = [
  { t: utc('2026-01-05'), open: 100, high: 100, low: 100, close: 100, volume: 1 },
  { t: utc('2026-01-06'), open: 99, high: 99, low: 99, close: 99, volume: 1 },
  { t: utc('2026-01-07'), open: 98, high: 98, low: 98, close: 98, volume: 1 },
  { t: utc('2026-01-08'), open: 105, high: 105, low: 105, close: 105, volume: 1 },
  { t: utc('2026-01-09'), open: 110, high: 110, low: 110, close: 110, volume: 1 },
];

describe('phase 2 integration', () => {
  it('drives a price>SMA(3) strategy through runBacktest with cache hits', async () => {
    const calendar = new USEquityCalendar();
    const cache = new MemoryFeatureCache();
    const range = { from: utc('2026-01-05'), to: utc('2026-01-10') };

    const barsCalls = vi.fn(async function* (_a: Asset, _r, _f) {
      for (const b of fixtureBars) yield b;
    });
    const dataFeed: DataFeed = { bars: barsCalls };

    const runtime = new FeatureRuntime({ dataFeed, featureCache: cache, range, freq: '1d' });

    const strategy: Strategy<{ price?: number; sma?: number }> = {
      universe: () => [SPY],
      features: async (_u, _p, t) => {
        const [priceSeries, smaSeries] = await Promise.all([
          runtime.compute({ kind: 'price' }, SPY),
          runtime.compute({ kind: 'sma', period: 3 }, SPY),
        ]);
        return {
          price: seriesAt(priceSeries, t),
          sma: seriesAt(smaSeries, t),
        };
      },
      build: (f, portfolio, _t) => {
        const target =
          f.price !== undefined && f.sma !== undefined && f.price > f.sma
            ? new Map([['us:SPY', 1]])
            : new Map<string, number>();
        const prices = f.price !== undefined ? new Map([['us:SPY', f.price]]) : new Map();
        return reconcile(target, portfolio, prices);
      },
    };

    const executor = new BacktestExecutor({
      calendar,
      nextOpen: async (_a, t) => {
        const next = fixtureBars.find((b) => b.t.getTime() > t.getTime());
        return next ? { t: next.t, price: next.open } : { t, price: 0 };
      },
    });

    const initialPortfolio: Portfolio = { cash: 10_000, positions: [], t: utc('2026-01-05') };

    const result = await runBacktest({
      strategy,
      range,
      initialPortfolio,
      dataFeed,
      executor,
      calendar,
      featureCache: cache,
    });

    expect(result.snapshots.length).toBe(5);
    // bars fetched at most once per asset (the runtime memoizes; cache is irrelevant the first run because base-series memoization wins)
    expect(barsCalls).toHaveBeenCalledTimes(1);
    // cache populated
    expect(
      await cache.get({
        feature: 'sma',
        paramsHash: '{"kind":"sma","period":3}',
        scope: { kind: 'asset', asset: 'us:SPY' },
        range,
        freq: '1d',
      }),
    ).toBeDefined();
  });
});
