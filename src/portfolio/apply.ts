import type { Portfolio, Position, PositionId, Lot, RealizedEvent } from './types';
import type { Order, Fill } from '../orders/types';
import { nextLotId } from './ids';

const newPositionId = (() => {
  let n = 0;
  return (): PositionId => `pos_${++n}`;
})();

function findOrder(orders: ReadonlyArray<Order>, id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

const MS_PER_DAY = 86_400_000;
// TODO(Task 5): replace with isLongTerm/holdingPeriodDays from ../tax/holding-period once that module exists (same >365-day rule).
const isLong = (openDate: Date, closeDate: Date): boolean =>
  (closeDate.getTime() - openDate.getTime()) / MS_PER_DAY > 365;

/**
 * Consume `qty` long shares of `assetId` from `lots`, oldest-first unless
 * `preferLotId` selects a specific lot first. Mutates the passed `lots` array
 * (caller owns a fresh copy) and pushes one {@link RealizedEvent} per slice to
 * `realized`. Throws {@link RangeError} if the ledger holds fewer shares than
 * requested.
 */
function consumeLots(
  lots: Lot[],
  realized: RealizedEvent[],
  assetId: string,
  qty: number,
  price: number,
  fees: number,
  closeDate: Date,
  preferLotId?: string,
): void {
  const sortedLots = lots
    .filter((l) => l.asset.id === assetId && l.quantity > 0)
    .sort((a, b) => {
      if (preferLotId) {
        if (a.id === preferLotId) return -1;
        if (b.id === preferLotId) return 1;
      }
      return a.openDate.getTime() - b.openDate.getTime();
    });
  const held = sortedLots.reduce((s, x) => s + x.quantity, 0);
  if (held < qty) {
    throw new RangeError(`applyFills: cannot sell ${qty} of ${assetId} — lot ledger holds ${held}`);
  }
  let need = qty;
  const totalQty = qty;
  for (const l of sortedLots) {
    if (need <= 0) break;
    const take = Math.min(l.quantity, need);
    const basisPerShare = l.basis / l.quantity;
    const consumedBasis = basisPerShare * take;
    const proceeds = take * price - (take / totalQty) * fees;
    realized.push({
      asset: l.asset,
      lotId: l.id,
      quantity: take,
      openDate: l.openDate,
      closeDate,
      proceeds,
      basis: consumedBasis,
      termType: isLong(l.openDate, closeDate) ? 'long' : 'short',
      gain: proceeds - consumedBasis,
      incomeKind: 'capital-gain',
    });
    l.quantity -= take;
    l.basis -= consumedBasis;
    need -= take;
  }
}

/**
 * Applies a batch of confirmed fills to a portfolio, returning a new
 * {@link Portfolio} snapshot. This is the single function that advances
 * portfolio state after order execution.
 *
 * For each fill the corresponding order is looked up in `orders` by
 * `fill.orderRef`. The order's `kind` determines the accounting treatment:
 * - `'open'`      — adds a new {@link Position} and debits cash.
 * - `'close'`     — removes shares from an existing position and credits cash.
 * - `'adjust'`    — updates the position's `quantity`; only fees are debited.
 * - `'rebalance'` — buys or sells shares in the long position for `asset`;
 *                   creates the position on a positive `delta`, removes it
 *                   when fully reduced. A reduce against a non-existent
 *                   long position is silently ignored (matching the same
 *                   case in {@link applyOrders}).
 *
 * The returned `portfolio.t` is updated to the maximum fill timestamp.
 *
 * In parallel with `positions`/`cash`, a long-side tax ledger is maintained:
 * buys (`open` long, `rebalance` delta>0) append a {@link Lot}; sells
 * (`close` of a long, `rebalance` delta<0) consume lots — by `fill.lotId` if
 * present, else FIFO oldest-first — pro-rating basis and appending one
 * {@link RealizedEvent} per consumed slice. Short positions and `adjust`
 * orders do not participate. The `positions`/`cash` outputs are unaffected by
 * this ledger.
 *
 * @param portfolio - The current portfolio state before this batch.
 * @param fills     - Execution confirmations returned by {@link Executor.submit}.
 *   Each fill's `orderRef` MUST match an `id` in `orders`.
 * @param orders    - The full order batch that was submitted. Used to look up
 *   order details for each fill.
 * @returns A new {@link Portfolio} with updated positions, cash, and timestamp.
 *   The input `portfolio` is not mutated.
 *
 * @example
 * ```ts
 * import { applyFills } from '@livefolio/sdk';
 * import type { Portfolio, Order, Fill } from '@livefolio/sdk';
 *
 * const portfolio: Portfolio = { cash: 10_000, positions: [], t: new Date('2024-01-01') };
 *
 * const order: Order = {
 *   id: 'ord_1', kind: 'open',
 *   asset: { kind: 'equity', id: 'AAPL', symbol: 'AAPL' },
 *   side: 'long', quantity: 10,
 * };
 * const fill: Fill = { orderRef: 'ord_1', t: new Date('2024-01-02'), quantity: 10, price: 185, fees: 0 };
 *
 * const next = applyFills(portfolio, [fill], [order]);
 * // next.cash === 8_250, next.positions.length === 1
 * ```
 */
export function applyFills(portfolio: Portfolio, fills: ReadonlyArray<Fill>, orders: ReadonlyArray<Order>): Portfolio {
  let positions: Position[] = [...portfolio.positions];
  let cash = portfolio.cash;
  let t = portfolio.t;
  // Parallel long-side tax ledger. Work on copies so the input is not mutated;
  // consumeLots mutates Lot objects in place, and filter/sort preserve object
  // identity, so reductions land back in `lots`.
  const lots: Lot[] = (portfolio.lots ?? []).map((l) => ({ ...l }));
  const realized: RealizedEvent[] = [...(portfolio.realized ?? [])];

  for (const fill of fills) {
    const order = findOrder(orders, fill.orderRef);
    if (!order) {
      throw new Error(`applyFills: fill.orderRef "${fill.orderRef}" matches no known order`);
    }
    t = fill.t > t ? fill.t : t;

    switch (order.kind) {
      case 'open': {
        const pos: Position = {
          id: newPositionId(),
          asset: order.asset,
          side: order.side,
          quantity: fill.quantity,
          entry: { date: fill.t, price: fill.price },
          basis: fill.quantity * fill.price + fill.fees,
        };
        positions.push(pos);
        cash -= fill.quantity * fill.price + fill.fees;
        if (order.side === 'long') {
          lots.push({
            id: nextLotId(),
            asset: order.asset,
            quantity: fill.quantity,
            openDate: fill.t,
            openPrice: fill.price,
            basis: fill.quantity * fill.price + fill.fees,
          });
        }
        break;
      }
      case 'close': {
        const idx = positions.findIndex((p) => p.id === order.positionId);
        if (idx < 0) throw new Error(`applyFills: close target ${order.positionId} not found`);
        const pos = positions[idx]!;
        const sign = pos.side === 'long' ? 1 : -1;
        cash += sign * fill.quantity * fill.price - fill.fees;
        const remaining = pos.quantity - fill.quantity;
        if (remaining <= 0) {
          positions = positions.filter((_, i) => i !== idx);
        } else {
          positions[idx] = { ...pos, quantity: remaining };
        }
        if (pos.side === 'long') {
          consumeLots(lots, realized, pos.asset.id, fill.quantity, fill.price, fill.fees, fill.t, fill.lotId);
        }
        break;
      }
      case 'adjust': {
        const idx = positions.findIndex((p) => p.id === order.positionId);
        if (idx < 0) throw new Error(`applyFills: adjust target ${order.positionId} not found`);
        const pos = positions[idx]!;
        const nextQty = order.changes.quantity ?? pos.quantity;
        positions[idx] = { ...pos, quantity: nextQty };
        cash -= fill.fees;
        break;
      }
      case 'rebalance': {
        const idx = positions.findIndex((p) => p.asset.id === order.asset.id && p.side === 'long');
        if (order.delta > 0) {
          const cost = fill.quantity * fill.price + fill.fees;
          cash -= cost;
          if (idx < 0) {
            positions.push({
              id: newPositionId(),
              asset: order.asset,
              side: 'long',
              quantity: fill.quantity,
              entry: { date: fill.t, price: fill.price },
              basis: cost,
            });
          } else {
            const prev = positions[idx]!;
            positions[idx] = {
              ...prev,
              quantity: prev.quantity + fill.quantity,
              basis: prev.basis + cost,
            };
          }
          lots.push({
            id: nextLotId(),
            asset: order.asset,
            quantity: fill.quantity,
            openDate: fill.t,
            openPrice: fill.price,
            basis: cost,
          });
        } else if (idx >= 0) {
          const prev = positions[idx]!;
          cash += fill.quantity * fill.price - fill.fees;
          const remaining = prev.quantity - fill.quantity;
          if (remaining <= 0) {
            positions = positions.filter((_, i) => i !== idx);
          } else {
            const basisPerShare = prev.basis / prev.quantity;
            positions[idx] = {
              ...prev,
              quantity: remaining,
              basis: basisPerShare * remaining,
            };
          }
          consumeLots(lots, realized, order.asset.id, fill.quantity, fill.price, fill.fees, fill.t, fill.lotId);
        }
        // No-op when reducing a non-existent long position. This matches the
        // contract of `applyOrders` (same case in the structural projection
        // also no-ops) and avoids destabilising a backtest on a stray reduce.
        // The defence in depth here pairs with the `targetShares` clamp in
        // `reconcile`, which is the primary path that previously produced
        // such reduces. See #37.
        break;
      }
    }

    // Prune fully-consumed lots after each fill.
    for (let i = lots.length - 1; i >= 0; i--) {
      if (lots[i]!.quantity <= 1e-9) lots.splice(i, 1);
    }
  }

  return { cash, positions, lots, realized, t };
}

/**
 * Projects a portfolio forward through a set of pending (unfilled) orders,
 * returning a structurally updated snapshot. Used by strategy build helpers
 * to read the expected post-step state before fills arrive.
 *
 * **v0.4 contract — structural projection only.** Quantities are updated
 * exactly as the orders specify, but:
 * - `cash` is left unchanged (no price is available at projection time).
 * - Newly opened positions have `basis: 0` and `entry.price: 0` as
 *   provisional values. A price-aware projection is planned for a later phase.
 *
 * Use {@link applyFills} (not this function) to settle the portfolio after
 * confirmed execution.
 *
 * @param portfolio - The current portfolio state to project from.
 * @param orders    - The pending orders to apply structurally. Order must have
 *   a valid `id` and `kind`; price fields are ignored.
 * @returns A new {@link Portfolio} with positions reflecting the orders.
 *   `cash` and `t` are copied unchanged from `portfolio`.
 *
 * @example
 * ```ts
 * import { applyOrders } from '@livefolio/sdk';
 * import type { Portfolio, Order } from '@livefolio/sdk';
 *
 * const portfolio: Portfolio = { cash: 10_000, positions: [], t: new Date('2024-01-01') };
 *
 * const order: Order = {
 *   id: 'ord_1', kind: 'open',
 *   asset: { kind: 'equity', id: 'AAPL', symbol: 'AAPL' },
 *   side: 'long', quantity: 10,
 * };
 *
 * const projected = applyOrders(portfolio, [order]);
 * // projected.positions.length === 1, projected.cash === 10_000 (unchanged)
 * ```
 */
export function applyOrders(portfolio: Portfolio, orders: ReadonlyArray<Order>): Portfolio {
  let positions: Position[] = [...portfolio.positions];

  for (const order of orders) {
    switch (order.kind) {
      case 'open': {
        positions.push({
          id: newPositionId(),
          asset: order.asset,
          side: order.side,
          quantity: order.quantity,
          entry: { date: portfolio.t, price: 0 },
          basis: 0,
        });
        break;
      }
      case 'close': {
        const idx = positions.findIndex((p) => p.id === order.positionId);
        if (idx < 0) break;
        const pos = positions[idx]!;
        const remove = order.quantity ?? pos.quantity;
        const remaining = pos.quantity - remove;
        if (remaining <= 0) {
          positions = positions.filter((_, i) => i !== idx);
        } else {
          positions[idx] = { ...pos, quantity: remaining };
        }
        break;
      }
      case 'adjust': {
        const idx = positions.findIndex((p) => p.id === order.positionId);
        if (idx < 0) break;
        const pos = positions[idx]!;
        positions[idx] = { ...pos, quantity: order.changes.quantity ?? pos.quantity };
        break;
      }
      case 'rebalance': {
        const idx = positions.findIndex((p) => p.asset.id === order.asset.id && p.side === 'long');
        if (order.delta > 0) {
          if (idx < 0) {
            positions.push({
              id: newPositionId(),
              asset: order.asset,
              side: 'long',
              quantity: order.delta,
              entry: { date: portfolio.t, price: 0 },
              basis: 0,
            });
          } else {
            const prev = positions[idx]!;
            positions[idx] = { ...prev, quantity: prev.quantity + order.delta };
          }
        } else if (idx >= 0) {
          const prev = positions[idx]!;
          const remaining = prev.quantity + order.delta;
          if (remaining <= 0) {
            positions = positions.filter((_, i) => i !== idx);
          } else {
            positions[idx] = { ...prev, quantity: remaining };
          }
        }
        break;
      }
    }
  }

  return { ...portfolio, positions };
}
