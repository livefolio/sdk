import type { Lot, RealizedEvent } from '../portfolio/types';

const MS_PER_DAY = 86_400_000;

/**
 * Calendar days between a lot's open date and `asOf` (float; may be fractional
 * or negative if `asOf` precedes `openDate`). Callers may `Math.floor` it.
 */
export function holdingPeriodDays(lot: Lot, asOf: Date): number {
  return (asOf.getTime() - lot.openDate.getTime()) / MS_PER_DAY;
}

/** IRS §1222 rule: a holding period of strictly more than 365 calendar days is long-term. */
export function isLongTerm(days: number): boolean {
  return days > 365;
}

/** Result of {@link realize}: the realized event plus what's left of the lot (`null` on a full sale). */
export type RealizeResult = { event: RealizedEvent; remainingLot: Lot | null };

/**
 * Realizes `qty` shares of `lot` at `salePrice` as of `asOf`, producing one
 * {@link RealizedEvent} and the remaining lot (or `null` on a full sale).
 *
 * Pure gain/loss primitive for estimation and lot ranking (e.g. selectMinTax,
 * TLH preview). It does **not** model transaction fees: pass a `salePrice` that
 * is already net of any per-share fee if you need fee-adjusted proceeds. The
 * stateful, fee-aware realization path used during execution lives in
 * `applyFills` (`consumeLots`), which pro-rates `fill.fees` across slices.
 *
 * Basis is pro-rated as `lot.basis / lot.quantity * qty` (so any
 * `washSaleAdjustment` already folded into `lot.basis` is carried through).
 *
 * @param lot - The lot to realize against.
 * @param qty - Shares to realize. Must be `> 0` and `<= lot.quantity`.
 * @param salePrice - Per-share sale price (net of fees if fee-adjustment is desired).
 * @param asOf - Sale date; drives short/long classification via the 365-day rule.
 * @returns `{ event, remainingLot }`; `remainingLot` is `null` when the whole lot is sold.
 * @throws {RangeError} if `qty <= 0` or `qty > lot.quantity`.
 */
export function realize(lot: Lot, qty: number, salePrice: number, asOf: Date): RealizeResult {
  if (qty <= 0) throw new RangeError(`realize: qty must be positive, got ${qty}`);
  if (qty > lot.quantity) throw new RangeError(`realize: lot ${lot.id} has ${lot.quantity}, cannot sell ${qty}`);
  const basisPerShare = lot.basis / lot.quantity;
  const basis = basisPerShare * qty;
  const proceeds = qty * salePrice;
  const event: RealizedEvent = {
    asset: lot.asset,
    lotId: lot.id,
    quantity: qty,
    openDate: lot.openDate,
    closeDate: asOf,
    proceeds,
    basis,
    termType: isLongTerm(holdingPeriodDays(lot, asOf)) ? 'long' : 'short',
    gain: proceeds - basis,
    incomeKind: 'capital-gain',
  };
  const remainingLot: Lot | null =
    qty === lot.quantity ? null : { ...lot, quantity: lot.quantity - qty, basis: lot.basis - basis };
  return { event, remainingLot };
}
