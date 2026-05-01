import { describe, it, expect } from 'vitest';
import { runBacktest } from './run-backtest';
import { USEquityCalendar } from '../reference/us-equity-calendar';
import type { Strategy } from './types';
import type { Asset } from '../interfaces/types';
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
      calendar: new USEquityCalendar(),
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
      calendar: new USEquityCalendar(),
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
      calendar: new USEquityCalendar(),
    });
    expect(received).toEqual({ price: 123 });
  });
});
