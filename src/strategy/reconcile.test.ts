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

  it('uses the assetId as the symbol when fabricating an Asset without an assets map', () => {
    const orders = reconcile(
      new Map([
        ['QQQ:L2', 0.5],
        ['GLD:L2', 0.5],
      ]),
      cashOnly(10_000),
      new Map([
        ['QQQ:L2', 1620.56],
        ['GLD:L2', 1878.34],
      ]),
    );
    const symbolById = Object.fromEntries(orders.map((o) => [o.asset.id, o.asset.symbol]));
    expect(symbolById['QQQ:L2']).toBe('QQQ:L2');
    expect(symbolById['GLD:L2']).toBe('GLD:L2');
  });

  it('looks up the canonical symbol from the assets map for never-held ids', () => {
    const QQQ_L2: Asset = { kind: 'equity', id: 'QQQ:L2', symbol: 'QQQ2X' };
    const GLD_L2: Asset = { kind: 'equity', id: 'GLD:L2', symbol: 'GLD2X' };
    const orders = reconcile(
      new Map([
        ['QQQ:L2', 0.5],
        ['GLD:L2', 0.5],
      ]),
      cashOnly(10_000),
      new Map([
        ['QQQ:L2', 1620.56],
        ['GLD:L2', 1878.34],
      ]),
      new Map([
        [QQQ_L2.id, QQQ_L2],
        [GLD_L2.id, GLD_L2],
      ]),
    );
    const symbolById = Object.fromEntries(orders.map((o) => [o.asset.id, o.asset.symbol]));
    expect(symbolById['QQQ:L2']).toBe('QQQ2X');
    expect(symbolById['GLD:L2']).toBe('GLD2X');
  });
});
