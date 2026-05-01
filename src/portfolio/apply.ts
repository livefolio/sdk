import type { Portfolio, Position, PositionId } from './types';
import type { Order, Fill } from '../orders/types';

const newPositionId = (() => {
  let n = 0;
  return (): PositionId => `pos_${++n}`;
})();

function findOrder(orders: ReadonlyArray<Order>, id: string): Order | undefined {
  return orders.find((o) => o.id === id);
}

export function applyFills(portfolio: Portfolio, fills: ReadonlyArray<Fill>, orders: ReadonlyArray<Order>): Portfolio {
  let positions: Position[] = [...portfolio.positions];
  let cash = portfolio.cash;
  let t = portfolio.t;

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
        } else {
          if (idx < 0) {
            throw new Error(`applyFills: rebalance reduce on ${order.asset.id} but no long position exists`);
          }
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
        }
        break;
      }
    }
  }

  return { cash, positions, t };
}

/**
 * Projects a portfolio forward through pending (unfilled) orders. Used by
 * Strategy.build to read the post-prior-step state when composing helpers.
 *
 * v0.4 contract: structural projection only. `quantity` updates exactly,
 * but `cash` is left unchanged and basis on freshly opened/projected lots
 * is provisional (0). A price-aware projection comes in a later phase.
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
