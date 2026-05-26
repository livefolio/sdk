import type { Lot } from '../portfolio/types';
import type { DividendEvent } from '../interfaces/types';

const MS_PER_DAY = 86_400_000;

/**
 * Options for the 60-of-121-day qualified-dividend holding test.
 *
 * Both fields default to values for common stock dividends: the investor must
 * have held the lot throughout the 60-day window ending at the ex-dividend date, within
 * the 121-day window that begins 60 days before the ex-date.
 */
export type QualificationOpts = {
  /** Minimum days the lot must be held within the window. Defaults to `60`. */
  holdingDaysRequired?: number;
  /** Width of the holding window in calendar days. Defaults to `121`. */
  windowDays?: number;
};

/**
 * Determines whether a single {@link Lot} satisfies the IRS 60-of-121-day
 * qualified-dividend holding requirement as of a given `exDate`.
 *
 * The 121-day window is centred on `exDate` with `half = floor(121 / 2) = 60`,
 * so it spans the 60 days before `exDate`, the ex-date itself, and the 60 days
 * after. Only days the lot was held **on or before** `exDate` count — `heldTo`
 * is capped at `exDate` so future hold time never qualifies a dividend. This
 * keeps the test lookahead-free and conservative: it never over-grants
 * qualified status. Because `heldTo` is capped at `exDate`, the most a lot can
 * accumulate is the 60-day run-up to the ex-date, so the default threshold of
 * `60` models "held throughout the 60-day window ending at ex-date"
 * (`60 >= 60`). Returns `true` when the days held within the window are
 * `>= holdingDaysRequired`.
 *
 * @param lot - The tax lot to test.
 * @param exDate - The dividend ex-dividend date.
 * @param opts - Optional overrides for `holdingDaysRequired` (default `60` —
 *   "held throughout the 60-day window ending at ex-date") and `windowDays`
 *   (default `121`).
 * @returns `true` when the lot satisfies the holding-period test.
 */
export function isQualifiedForLot(lot: Lot, exDate: Date, opts: QualificationOpts = {}): boolean {
  const required = opts.holdingDaysRequired ?? 60;
  const window = opts.windowDays ?? 121;
  const half = Math.floor(window / 2);
  const windowStart = new Date(exDate.getTime() - half * MS_PER_DAY);
  const windowEnd = new Date(exDate.getTime() + half * MS_PER_DAY);
  const heldFrom = lot.openDate > windowStart ? lot.openDate : windowStart;
  const heldTo = exDate < windowEnd ? exDate : windowEnd;
  const days = Math.max(0, (heldTo.getTime() - heldFrom.getTime()) / MS_PER_DAY);
  return days >= required;
}

/**
 * The result of {@link distributeDividend}: per-lot cash amounts with
 * qualified/ordinary classification, plus rolled-up totals.
 */
export type DividendDistribution = {
  /** Rolled-up qualified and ordinary dividend totals across all participating lots. */
  totals: { qualified: number; ordinary: number };
  /** One entry per participating lot: the cash received and whether it is qualified. */
  perLot: { lotId: string; cash: number; qualified: boolean }[];
};

/**
 * Distributes a {@link DividendEvent} across a set of lots held at the
 * ex-dividend date, classifying each lot's income as qualified or ordinary.
 *
 * Only lots that pass all three eligibility tests participate:
 * - `quantity > 0`
 * - `openDate <= exDate` (lot was open before or on the ex-date)
 * - `asset.id === event.asset.id` (same asset)
 *
 * For `incomeKind: 'ordinary'` or `'interest'` events every participating lot
 * is classified as ordinary regardless of how long it was held. For
 * `'qualified-eligible'` events each lot is tested individually via
 * {@link isQualifiedForLot} using the default 60-of-121-day rule.
 *
 * @param event - The dividend event to distribute.
 * @param lotsHeldAtExDate - All lots in the portfolio at the ex-dividend date
 *   (the function filters to eligible ones internally).
 * @returns A {@link DividendDistribution} with per-lot breakdown and rolled-up totals.
 */
export function distributeDividend(
  event: DividendEvent,
  lotsHeldAtExDate: readonly Lot[],
): DividendDistribution {
  const eligible = event.incomeKind === 'qualified-eligible';
  const perLot: DividendDistribution['perLot'] = [];
  let qualified = 0,
    ordinary = 0;
  for (const lot of lotsHeldAtExDate) {
    if (lot.quantity <= 0 || lot.openDate > event.exDate || lot.asset.id !== event.asset.id) continue;
    const cash = lot.quantity * event.amountPerShare;
    const isQ = eligible && isQualifiedForLot(lot, event.exDate);
    perLot.push({ lotId: lot.id, cash, qualified: isQ });
    if (isQ) qualified += cash;
    else ordinary += cash;
  }
  return { totals: { qualified, ordinary }, perLot };
}
