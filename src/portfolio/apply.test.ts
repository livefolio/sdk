import { describe, it, expect } from 'vitest';
import { applyFills, applyOrders } from './apply';
import type { Portfolio } from './types';
import type { Order, Fill } from '../orders/types';
import type { Asset } from '../interfaces/types';

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };
const T0 = new Date('2026-01-02T00:00:00Z');
const T1 = new Date('2026-01-03T00:00:00Z');

const empty: Portfolio = { cash: 10_000, positions: [], t: T0 };

describe('applyFills', () => {
  it('opens a long position from an OpenOrder fill', () => {
    const order: Order = { id: 'o1', kind: 'open', asset: SPY, side: 'long', quantity: 10 };
    const fill: Fill = { orderRef: 'o1', t: T1, quantity: 10, price: 400, fees: 1 };
    const next = applyFills(empty, [fill], [order]);
    expect(next.positions).toHaveLength(1);
    const p = next.positions[0]!;
    expect(p.asset.id).toBe('us:SPY');
    expect(p.quantity).toBe(10);
    expect(p.basis).toBe(10 * 400 + 1);
    expect(next.cash).toBe(10_000 - 10 * 400 - 1);
    expect(next.t).toEqual(T1);
  });

  it('removes a position when a CloseOrder fills the full quantity', () => {
    const opened = applyFills(
      empty,
      [{ orderRef: 'o1', t: T0, quantity: 10, price: 400, fees: 0 }],
      [{ id: 'o1', kind: 'open', asset: SPY, side: 'long', quantity: 10 }],
    );
    const close: Order = { id: 'c1', kind: 'close', positionId: opened.positions[0]!.id };
    const closed = applyFills(opened, [{ orderRef: 'c1', t: T1, quantity: 10, price: 410, fees: 1 }], [close]);
    expect(closed.positions).toHaveLength(0);
    expect(closed.cash).toBe(10_000 - 10 * 400 + 10 * 410 - 1);
  });

  it('reduces a position when a CloseOrder fills partial quantity', () => {
    const opened = applyFills(
      empty,
      [{ orderRef: 'o1', t: T0, quantity: 10, price: 400, fees: 0 }],
      [{ id: 'o1', kind: 'open', asset: SPY, side: 'long', quantity: 10 }],
    );
    const close: Order = { id: 'c1', kind: 'close', positionId: opened.positions[0]!.id, quantity: 4 };
    const closed = applyFills(opened, [{ orderRef: 'c1', t: T1, quantity: 4, price: 410, fees: 0 }], [close]);
    expect(closed.positions).toHaveLength(1);
    expect(closed.positions[0]!.quantity).toBe(6);
  });

  it('opens a new long position via positive RebalanceOrder', () => {
    const order: Order = { id: 'r1', kind: 'rebalance', asset: SPY, delta: 5 };
    const fill: Fill = { orderRef: 'r1', t: T1, quantity: 5, price: 400, fees: 0 };
    const next = applyFills(empty, [fill], [order]);
    expect(next.positions).toHaveLength(1);
    expect(next.positions[0]!.quantity).toBe(5);
    expect(next.positions[0]!.side).toBe('long');
  });

  it('reduces an existing long via negative RebalanceOrder', () => {
    const opened = applyFills(
      empty,
      [{ orderRef: 'o1', t: T0, quantity: 10, price: 400, fees: 0 }],
      [{ id: 'o1', kind: 'open', asset: SPY, side: 'long', quantity: 10 }],
    );
    const order: Order = { id: 'r1', kind: 'rebalance', asset: SPY, delta: -3 };
    const next = applyFills(opened, [{ orderRef: 'r1', t: T1, quantity: 3, price: 410, fees: 0 }], [order]);
    expect(next.positions[0]!.quantity).toBe(7);
  });

  it('throws when a fill references no known order', () => {
    expect(() => applyFills(empty, [{ orderRef: 'unknown', t: T1, quantity: 1, price: 1, fees: 0 }], [])).toThrow(
      /orderRef/,
    );
  });

  it('does not mutate the input portfolio', () => {
    const order: Order = { id: 'o1', kind: 'open', asset: SPY, side: 'long', quantity: 10 };
    const fill: Fill = { orderRef: 'o1', t: T1, quantity: 10, price: 400, fees: 0 };
    applyFills(empty, [fill], [order]);
    expect(empty.positions).toHaveLength(0);
    expect(empty.cash).toBe(10_000);
  });
});

describe('applyOrders (projection)', () => {
  it('projects an OpenOrder as a position with provisional basis', () => {
    const order: Order = { id: 'o1', kind: 'open', asset: SPY, side: 'long', quantity: 10 };
    const projected = applyOrders(empty, [order]);
    expect(projected.positions).toHaveLength(1);
    expect(projected.positions[0]!.quantity).toBe(10);
    expect(projected.cash).toBe(10_000);
  });

  it('projects a negative RebalanceOrder as a quantity reduction', () => {
    const opened = applyFills(
      empty,
      [{ orderRef: 'o1', t: T0, quantity: 10, price: 400, fees: 0 }],
      [{ id: 'o1', kind: 'open', asset: SPY, side: 'long', quantity: 10 }],
    );
    const projected = applyOrders(opened, [{ id: 'r1', kind: 'rebalance', asset: SPY, delta: -4 }]);
    expect(projected.positions[0]!.quantity).toBe(6);
  });
});
