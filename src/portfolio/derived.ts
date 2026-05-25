import type { Lot, Portfolio, Position } from './types';

/**
 * Aggregates a portfolio's tax {@link Lot}s into a per-asset {@link Position}
 * view (`side: 'long'`). The lot-level analogue of `portfolio.positions`,
 * offered for consumers that want a single position per asset derived from the
 * cost-basis ledger. `reconcile` continues to read `portfolio.positions`.
 *
 * The returned ids are synthetic view keys (`lot_view_<assetId>`) — they are
 * NOT stable `PositionId`s and must not be passed to `CloseOrder.positionId`
 * or compared against `portfolio.positions[*].id`.
 *
 * @param portfolio - Source portfolio; reads `portfolio.lots` (treated as `[]` when absent).
 * @returns One {@link Position} per distinct asset id, summing quantity and basis,
 *   with `entry` taken from the earliest lot. Empty when there are no lots.
 */
export function positionsByAsset(portfolio: Portfolio): Position[] {
  const byId = new Map<
    string,
    { asset: Lot['asset']; quantity: number; basis: number; openDate: Date; openPrice: number }
  >();
  for (const lot of portfolio.lots ?? []) {
    const cur = byId.get(lot.asset.id);
    if (cur) {
      cur.quantity += lot.quantity;
      cur.basis += lot.basis;
      if (lot.openDate < cur.openDate) {
        cur.openDate = lot.openDate;
        cur.openPrice = lot.openPrice;
      }
    } else {
      byId.set(lot.asset.id, {
        asset: lot.asset,
        quantity: lot.quantity,
        basis: lot.basis,
        openDate: lot.openDate,
        openPrice: lot.openPrice,
      });
    }
  }
  return Array.from(byId.values()).map((agg) => ({
    id: `lot_view_${agg.asset.id}`,
    asset: agg.asset,
    side: 'long' as const,
    quantity: agg.quantity,
    entry: { date: agg.openDate, price: agg.openPrice },
    basis: agg.basis,
  }));
}
