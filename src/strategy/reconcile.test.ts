import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import type { Portfolio } from '../portfolio/types';
import type { Asset } from '../interfaces/types';

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };
const AGG: Asset = { kind: 'equity', id: 'us:AGG', symbol: 'AGG' };
const T = new Date('2026-01-02T00:00:00Z');

const cashOnly = (cash: number): Portfolio => ({ cash, positions: [], t: T });

describe('reconcile', () => {
  it('emits a buy when target is set and portfolio is all cash', () => {
    const orders = reconcile(new Map([['us:SPY', 1]]), cashOnly(10_000), new Map([['us:SPY', 400]]));
    expect(orders).toHaveLength(1);
    expect(orders[0]!.kind).toBe('rebalance');
    expect(orders[0]!.asset.id).toBe('us:SPY');
    expect(orders[0]!.delta).toBe(25);
  });

  it('emits a sell-to-zero for held assets not in targets', () => {
    const portfolio: Portfolio = {
      cash: 0,
      t: T,
      positions: [
        {
          id: 'p1',
          asset: SPY,
          side: 'long',
          quantity: 10,
          entry: { date: T, price: 400 },
          basis: 4000,
        },
      ],
    };
    const orders = reconcile(new Map(), portfolio, new Map([['us:SPY', 410]]));
    expect(orders).toHaveLength(1);
    expect(orders[0]!.delta).toBe(-10);
  });

  it('produces a mixed buy+sell when shifting allocation', () => {
    const portfolio: Portfolio = {
      cash: 0,
      t: T,
      positions: [
        {
          id: 'p1',
          asset: SPY,
          side: 'long',
          quantity: 25,
          entry: { date: T, price: 400 },
          basis: 10_000,
        },
      ],
    };
    const orders = reconcile(
      new Map([
        [SPY.id, 0.5],
        [AGG.id, 0.5],
      ]),
      portfolio,
      new Map([
        [SPY.id, 400],
        [AGG.id, 100],
      ]),
    );
    const bySymbol = Object.fromEntries(orders.map((o) => [o.asset.id, o.delta]));
    expect(bySymbol[SPY.id]).toBe(-13);
    expect(bySymbol[AGG.id]).toBe(50);
  });

  it('throws when a target lacks a price', () => {
    expect(() => reconcile(new Map([['us:SPY', 1]]), cashOnly(1000), new Map())).toThrow(/price/);
  });
});
