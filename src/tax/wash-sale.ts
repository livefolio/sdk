import type { Lot, RealizedEvent } from '../portfolio/types';

const MS_PER_DAY = 86_400_000;

/**
 * A single wash-sale determination (IRS §1091): a realized capital loss whose
 * deduction is disallowed because a substantially-identical replacement lot was
 * acquired within the wash-sale window. The disallowed loss is rolled into the
 * replacement lot's cost basis.
 *
 * At most one adjustment is produced per loss event — the first matching
 * replacement lot found wins.
 */
export type WashSaleAdjustment = {
  /** `lotId` of the {@link RealizedEvent} whose loss is being disallowed. */
  lossEventLotId: string;
  /**
   * The disallowed loss as a positive number (`-gain` of the loss event). This
   * amount is added to the replacement lot's `basis`.
   */
  disallowedAmount: number;
  /** `id` of the {@link Lot} that absorbs the disallowed loss into its basis. */
  replacementLotId: string;
};

/**
 * Find wash sales among realized capital losses (IRS §1091).
 *
 * For each `capital-gain` {@link RealizedEvent} with a loss (`gain < 0`) that is
 * not already marked, this looks for a same-asset replacement {@link Lot} opened
 * within ±`windowDays` of the loss event's `closeDate`. When one is found, a
 * single {@link WashSaleAdjustment} is emitted — at most one per loss event (the
 * first matching replacement lot wins).
 *
 * Events that are gains (`gain >= 0`), are not `capital-gain` income (e.g.
 * dividends, interest), or already carry a `washSaleDisallowed` value are
 * skipped. The loss event's own lot is never treated as its own replacement.
 *
 * The reported `disallowedAmount` is `-gain` — a positive number equal to the
 * loss magnitude.
 *
 * @param realized - Realized events to scan for disallowed losses.
 * @param lots - Open lots that may serve as replacement positions.
 * @param options - `windowDays` is the half-width (in days) of the symmetric
 *   window around `closeDate`; defaults to `30`.
 * @returns One {@link WashSaleAdjustment} per matched loss event.
 *
 * @see {@link applyWashSaleAdjustment} to roll the disallowed loss into the lot.
 */
export function findWashSales(
  realized: readonly RealizedEvent[],
  lots: readonly Lot[],
  options: { windowDays?: number } = {},
): WashSaleAdjustment[] {
  const window = options.windowDays ?? 30;
  const out: WashSaleAdjustment[] = [];
  for (const ev of realized) {
    if (ev.gain >= 0 || ev.incomeKind !== 'capital-gain' || ev.washSaleDisallowed !== undefined) continue;
    const winStart = ev.closeDate.getTime() - window * MS_PER_DAY;
    const winEnd = ev.closeDate.getTime() + window * MS_PER_DAY;
    const replacement = lots.find(
      (l) =>
        l.asset.id === ev.asset.id &&
        l.id !== ev.lotId &&
        l.openDate.getTime() >= winStart &&
        l.openDate.getTime() <= winEnd,
    );
    if (replacement) out.push({ lossEventLotId: ev.lotId, disallowedAmount: -ev.gain, replacementLotId: replacement.id });
  }
  return out;
}

/**
 * Apply a {@link WashSaleAdjustment} by rolling the disallowed loss into the
 * replacement lot's basis (IRS §1091).
 *
 * Returns a new array in which the replacement lot (matched by
 * `adj.replacementLotId`) has both its `basis` and its running
 * `washSaleAdjustment` increased by `adj.disallowedAmount`. All other lots are
 * returned unchanged. Lots are never mutated in place.
 *
 * @param lots - The current set of lots.
 * @param adj - The adjustment to apply, from {@link findWashSales}.
 * @returns A new lot array with the replacement lot's basis bumped.
 */
export function applyWashSaleAdjustment(lots: readonly Lot[], adj: WashSaleAdjustment): Lot[] {
  return lots.map((l) =>
    l.id === adj.replacementLotId
      ? { ...l, basis: l.basis + adj.disallowedAmount, washSaleAdjustment: (l.washSaleAdjustment ?? 0) + adj.disallowedAmount }
      : l,
  );
}
