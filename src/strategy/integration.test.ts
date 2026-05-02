import { describe, it, expect } from 'vitest';
import { runBacktest, reconcile, type Strategy } from '.';
import { MemoryFeatureCache, BacktestExecutor } from '../reference';
import { NYSEExchangeCalendar } from '../calendars';
import type { Portfolio } from '../portfolio';
import type { Asset, DataFeed } from '../interfaces';

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
