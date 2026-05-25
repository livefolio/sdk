import type { Lot, RealizedEvent } from '../portfolio/types';

const MS_PER_DAY = 86_400_000;

/** Float days between a lot's open date and `asOf`. Callers may floor. */
export function holdingPeriodDays(lot: Lot, asOf: Date): number {
  return (asOf.getTime() - lot.openDate.getTime()) / MS_PER_DAY;
}

/** IRS rule: a holding period of strictly more than 365 days is long-term. */
export function isLongTerm(days: number): boolean {
  return days > 365;
}

export type RealizeResult = { event: RealizedEvent; remainingLot: Lot | null };

/** Realize `qty` shares of `lot` at `salePrice` as of `asOf`. Pro-rates basis. */
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
