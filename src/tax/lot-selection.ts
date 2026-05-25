import type { Lot } from '../portfolio/types';
import { holdingPeriodDays, isLongTerm } from './holding-period';

/** A slice of a tax lot consumed to fulfill part of a sell order. */
export type LotSlice = { lotId: string; quantity: number };

/** Short-term and long-term capital-gains tax rates (as decimals, e.g. 0.37). */
export type TaxRates = { shortTerm: number; longTerm: number };

/**
 * Internal workhorse: consume `qty` shares from `sorted` lots in order,
 * skipping lots with `quantity <= 0`.
 *
 * @throws {RangeError} when the total available is less than `qty`.
 */
function take(sorted: readonly Lot[], qty: number): LotSlice[] {
  let need = qty;
  const out: LotSlice[] = [];
  for (const lot of sorted) {
    if (lot.quantity <= 0) continue;
    if (need <= 0) break;
    const q = Math.min(lot.quantity, need);
    out.push({ lotId: lot.id, quantity: q });
    need -= q;
  }
  if (need > 1e-9) {
    const held = sorted.reduce((s, l) => s + Math.max(0, l.quantity), 0);
    throw new RangeError(`lot-selection: need ${qty} but only ${held} held`);
  }
  return out;
}

/**
 * First-In-First-Out lot selection.
 *
 * Selects lots in ascending `openDate` order, consuming oldest lots first.
 */
export function selectFIFO(lots: readonly Lot[], qty: number): LotSlice[] {
  return take(
    [...lots].sort((a, b) => a.openDate.getTime() - b.openDate.getTime()),
    qty,
  );
}

/**
 * Last-In-First-Out lot selection.
 *
 * Selects lots in descending `openDate` order, consuming newest lots first.
 */
export function selectLIFO(lots: readonly Lot[], qty: number): LotSlice[] {
  return take(
    [...lots].sort((a, b) => b.openDate.getTime() - a.openDate.getTime()),
    qty,
  );
}

/**
 * Highest-In-First-Out lot selection.
 *
 * Selects lots in descending per-share basis (`basis / quantity`) order,
 * realizing the highest-cost lots first to minimize gains.
 */
export function selectHIFO(lots: readonly Lot[], qty: number): LotSlice[] {
  return take(
    [...lots].sort((a, b) => b.basis / b.quantity - a.basis / a.quantity),
    qty,
  );
}

/**
 * Tax-minimizing lot selection.
 *
 * Ranks lots by a 4-tier comparator designed to realize the least tax:
 * 1. Long-term losses  (tier 0) — offsets LT gains at the lower LT rate
 * 2. Short-term losses (tier 1) — offsets ST gains at the higher ST rate
 * 3. Long-term gains   (tier 2) — taxed at the lower LT rate
 * 4. Short-term gains  (tier 3) — taxed at the higher ST rate
 *
 * Within a tier, lots are sorted by ascending gain-per-share so that the
 * largest losses (or smallest gains) are consumed first.
 *
 * Uses `isLongTerm(holdingPeriodDays(lot, ctx.asOf))` for term classification
 * and `ctx.price - lot.basis / lot.quantity` for gain-per-share.
 */
export function selectMinTax(
  lots: readonly Lot[],
  qty: number,
  ctx: { price: number; asOf: Date; rates: TaxRates },
): LotSlice[] {
  const tier = (l: Lot): number => {
    const gainPerShare = ctx.price - l.basis / l.quantity;
    const lt = isLongTerm(holdingPeriodDays(l, ctx.asOf));
    if (gainPerShare < 0) return lt ? 0 : 1; // losses first: LT loss before ST loss
    return lt ? 2 : 3; // then gains: LT gain before ST gain
  };

  const sorted = [...lots]
    .filter((l) => l.quantity > 0)
    .sort((a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return ta - tb;
      // Within the same tier: smallest gain-per-share first (biggest loss first)
      const gainA = ctx.price - a.basis / a.quantity;
      const gainB = ctx.price - b.basis / b.quantity;
      return gainA - gainB;
    });

  return take(sorted, qty);
}
