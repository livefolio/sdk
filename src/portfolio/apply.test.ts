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

  // Regression for #37: a stray rebalance-reduce on an asset with no long
  // position used to hard-throw; the contract now matches `applyOrders` and
  // no-ops, since `reconcile` clamps `targetShares` at 0 to prevent the bad
  // order from being generated in the first place.
  it('silently ignores a negative RebalanceOrder when no long position exists', () => {
    const order: Order = { id: 'r1', kind: 'rebalance', asset: SPY, delta: -5 };
    const fill: Fill = { orderRef: 'r1', t: T1, quantity: 5, price: 400, fees: 0 };
    const next = applyFills(empty, [fill], [order]);
    expect(next.positions).toHaveLength(0);
    expect(next.cash).toBe(10_000);
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

  it('a rebalance buy creates a lot', () => {
    const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
    const p0 = { cash: 10_000, positions: [], lots: [], realized: [], t: new Date('2024-01-01') };
    const order = { id: 'o1', kind: 'rebalance' as const, asset, delta: 100 };
    const fill = { orderRef: 'o1', t: new Date('2024-01-02'), quantity: 100, price: 10, fees: 0 };
    const next = applyFills(p0, [fill], [order]);
    expect(next.lots).toHaveLength(1);
    expect(next.lots![0]!.quantity).toBe(100);
    expect(next.lots![0]!.basis).toBe(1000);
  });

  it('FIFO sell emits one realized event and reduces the oldest lot', () => {
    const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
    let p = { cash: 10_000, positions: [], lots: [], realized: [], t: new Date('2024-01-01') };
    p = applyFills(
      p,
      [{ orderRef: 'b', t: new Date('2024-01-02'), quantity: 100, price: 10, fees: 0 }],
      [{ id: 'b', kind: 'rebalance', asset, delta: 100 }],
    );
    p = applyFills(
      p,
      [{ orderRef: 's', t: new Date('2024-03-01'), quantity: 75, price: 30, fees: 0 }],
      [{ id: 's', kind: 'rebalance', asset, delta: -75 }],
    );
    expect(p.realized).toHaveLength(1);
    expect(p.realized![0]!.gain).toBeCloseTo(75 * 30 - 75 * 10);
    expect(p.realized![0]!.termType).toBe('short');
    expect(p.lots![0]!.quantity).toBe(25);
  });

  it('a sell spanning two lots emits two realized events', () => {
    const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
    let p = { cash: 100_000, positions: [], lots: [], realized: [], t: new Date('2024-01-01') };
    p = applyFills(
      p,
      [{ orderRef: 'b1', t: new Date('2024-01-02'), quantity: 100, price: 10, fees: 0 }],
      [{ id: 'b1', kind: 'rebalance', asset, delta: 100 }],
    );
    p = applyFills(
      p,
      [{ orderRef: 'b2', t: new Date('2024-02-02'), quantity: 50, price: 20, fees: 0 }],
      [{ id: 'b2', kind: 'rebalance', asset, delta: 50 }],
    );
    p = applyFills(
      p,
      [{ orderRef: 's', t: new Date('2024-03-01'), quantity: 120, price: 30, fees: 0 }],
      [{ id: 's', kind: 'rebalance', asset, delta: -120 }],
    );
    expect(p.realized).toHaveLength(2);
    expect(p.realized![0]!.quantity).toBe(100);
    expect(p.realized![1]!.quantity).toBe(20);
  });

  it('overselling the lot ledger throws RangeError', () => {
    const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
    let p = { cash: 10_000, positions: [], lots: [], realized: [], t: new Date('2024-01-01') };
    p = applyFills(
      p,
      [{ orderRef: 'b', t: new Date('2024-01-02'), quantity: 10, price: 10, fees: 0 }],
      [{ id: 'b', kind: 'rebalance', asset, delta: 10 }],
    );
    expect(() =>
      applyFills(
        p,
        [{ orderRef: 's', t: new Date('2024-03-01'), quantity: 50, price: 30, fees: 0 }],
        [{ id: 's', kind: 'rebalance', asset, delta: -50 }],
      ),
    ).toThrow(/cannot sell/);
  });

  it('honors fill.lotId over FIFO when present', () => {
    const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
    let p = { cash: 100_000, positions: [], lots: [], realized: [], t: new Date('2024-01-01') };
    p = applyFills(
      p,
      [{ orderRef: 'b1', t: new Date('2024-01-02'), quantity: 10, price: 10, fees: 0 }],
      [{ id: 'b1', kind: 'rebalance', asset, delta: 10 }],
    );
    p = applyFills(
      p,
      [{ orderRef: 'b2', t: new Date('2024-02-02'), quantity: 10, price: 20, fees: 0 }],
      [{ id: 'b2', kind: 'rebalance', asset, delta: 10 }],
    );
    const newerLotId = p.lots![1]!.id;
    p = applyFills(
      p,
      [{ orderRef: 's', t: new Date('2024-03-01'), quantity: 5, price: 30, fees: 0, lotId: newerLotId }],
      [{ id: 's', kind: 'rebalance', asset, delta: -5 }],
    );
    expect(p.realized![0]!.basis).toBeCloseTo(5 * 20);
  });

  it('long-term vs short-term classification by 365-day rule', () => {
    const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
    let p = { cash: 100_000, positions: [], lots: [], realized: [], t: new Date('2023-01-01') };
    p = applyFills(
      p,
      [{ orderRef: 'b', t: new Date('2023-01-01'), quantity: 10, price: 10, fees: 0 }],
      [{ id: 'b', kind: 'rebalance', asset, delta: 10 }],
    );
    p = applyFills(
      p,
      [{ orderRef: 's', t: new Date('2024-06-01'), quantity: 10, price: 20, fees: 0 }],
      [{ id: 's', kind: 'rebalance', asset, delta: -10 }],
    );
    expect(p.realized![0]!.termType).toBe('long');
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
