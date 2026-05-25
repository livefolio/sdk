import type { RealizedEvent } from '../portfolio/types';
import type { TaxRates } from './lot-selection';

/**
 * Maximum capital-loss deduction against ordinary income per IRS §1211(b).
 * In a given tax year, net capital losses above `ORDINARY_OFFSET_CAP` are
 * carried forward to future years rather than deducted immediately.
 */
export const ORDINARY_OFFSET_CAP = 3000;

/**
 * Year-level summary of taxable income across all categories.
 *
 * - `shortTermGains` / `longTermGains`: sum of positive `gain` values from
 *   capital-gain events in each term bucket.
 * - `shortTermLosses` / `longTermLosses`: sum of |negative `gain`| values
 *   (stored as **positive magnitudes**) from capital-gain events.
 * - `qualifiedDividends`: qualified dividend income (taxed at LT rate).
 * - `ordinaryDividends`: non-qualified dividend income (taxed at ST rate).
 * - `interestIncome`: interest income (taxed at ST rate).
 *
 * Capital losses **never** offset `qualifiedDividends` or `ordinaryDividends`.
 * The cross-offset logic in {@link crossOffset} operates only on the capital-
 * gain buckets; dividend/interest income is added post-offset at full value.
 */
export type TaxableIncome = {
  shortTermGains: number;
  /** Positive magnitude of short-term capital losses. */
  shortTermLosses: number;
  longTermGains: number;
  /** Positive magnitude of long-term capital losses. */
  longTermLosses: number;
  qualifiedDividends: number;
  ordinaryDividends: number;
  interestIncome: number;
};

/**
 * Partitions `events` into short-term and long-term capital-gain buckets.
 *
 * Events with `incomeKind !== 'capital-gain'` (dividends, interest) are
 * excluded entirely — they are not subject to the capital-gain offset logic.
 *
 * @param events - Flat array of {@link RealizedEvent}s for a single year or
 *   for the full history (caller selects the relevant slice).
 * @returns `{ short, long }` — two arrays of capital-gain events by term.
 */
export function bucketByTerm(events: readonly RealizedEvent[]): { short: RealizedEvent[]; long: RealizedEvent[] } {
  const short: RealizedEvent[] = [];
  const long: RealizedEvent[] = [];
  for (const e of events) {
    if (e.incomeKind !== 'capital-gain') continue;
    (e.termType === 'long' ? long : short).push(e);
  }
  return { short, long };
}

/**
 * Nets gains and losses within a single bucket (all-short or all-long).
 *
 * Events with `gain >= 0` contribute to `gains`; events with `gain < 0`
 * contribute to `losses` as a **positive magnitude**.
 *
 * @param events - Capital-gain events for one term bucket.
 * @returns `{ gains, losses, net }` where `net = gains - losses`.
 */
export function netWithinBucket(events: readonly RealizedEvent[]): { gains: number; losses: number; net: number } {
  let gains = 0;
  let losses = 0;
  for (const e of events) {
    if (e.gain >= 0) gains += e.gain;
    else losses += -e.gain;
  }
  return { gains, losses, net: gains - losses };
}

/**
 * Applies IRS capital-gain cross-offset rules between short-term and long-term nets.
 *
 * Rules (in order of precedence):
 * 1. **Both non-negative**: no offset; return each net unchanged.
 * 2. **Both negative**: combine losses; apply up to `ORDINARY_OFFSET_CAP` ($3,000)
 *    against ordinary income; remainder becomes `carryForward`.
 * 3. **Opposite signs, combined ≥ 0**: the loss bucket fully absorbs into the gain
 *    bucket; the residual stays in the gain bucket's term (`taxableShort` if
 *    `netShort > 0`, else `taxableLong`). No ordinary offset or carry-forward.
 * 4. **Opposite signs, combined < 0**: net loss after cross-offset;
 *    up to `ORDINARY_OFFSET_CAP` deducted against ordinary income; remainder
 *    becomes `carryForward`.
 *
 * **Important:** `ordinaryOffset` and `carryForward` apply only to capital
 * losses. Dividend and interest income is never offset by capital losses.
 *
 * @param netShort - Net short-term capital gain (negative = loss).
 * @param netLong  - Net long-term capital gain (negative = loss).
 * @returns `{ taxableShort, taxableLong, ordinaryOffset, carryForward }`.
 */
export function crossOffset(
  netShort: number,
  netLong: number,
): { taxableShort: number; taxableLong: number; ordinaryOffset: number; carryForward: number } {
  // Case 1: both non-negative — no offset needed
  if (netShort >= 0 && netLong >= 0) {
    return { taxableShort: netShort, taxableLong: netLong, ordinaryOffset: 0, carryForward: 0 };
  }

  // Case 2: both negative — combine into a single net loss
  if (netShort < 0 && netLong < 0) {
    const totalLoss = -(netShort + netLong);
    const ordinaryOffset = Math.min(ORDINARY_OFFSET_CAP, totalLoss);
    return { taxableShort: 0, taxableLong: 0, ordinaryOffset, carryForward: totalLoss - ordinaryOffset };
  }

  // Case 3 & 4: opposite signs — cross-offset the loss against the gain
  const combined = netShort + netLong;

  if (combined >= 0) {
    // The loss bucket was fully absorbed; residual remains in the positive bucket's term
    const taxableShort = netShort > 0 ? combined : 0;
    const taxableLong = netLong > 0 ? combined : 0;
    return {
      taxableShort: Math.max(0, taxableShort),
      taxableLong: Math.max(0, taxableLong),
      ordinaryOffset: 0,
      carryForward: 0,
    };
  }

  // combined < 0: net loss after cross-offset
  const loss = -combined;
  const ordinaryOffset = Math.min(ORDINARY_OFFSET_CAP, loss);
  return { taxableShort: 0, taxableLong: 0, ordinaryOffset, carryForward: loss - ordinaryOffset };
}

/**
 * Aggregates {@link RealizedEvent}s by UTC calendar year into a
 * {@link TaxableIncome} map.
 *
 * Keyed by `closeDate.getUTCFullYear()`. Each event is routed:
 * - `capital-gain`: bucketed into `shortTermGains`/`shortTermLosses` (ST) or
 *   `longTermGains`/`longTermLosses` (LT) by `termType` and sign of `gain`.
 *   Losses are stored as **positive magnitudes**.
 * - `qualified-dividend`: adds `proceeds` to `qualifiedDividends`.
 * - `ordinary-dividend`: adds `proceeds` to `ordinaryDividends`.
 * - `interest`: adds `proceeds` to `interestIncome`.
 *
 * @param events - Full sequence of realized events (multiple years OK).
 * @returns `Map<year, TaxableIncome>` with one entry per UTC calendar year.
 */
export function aggregateByYear(events: readonly RealizedEvent[]): Map<number, TaxableIncome> {
  const out = new Map<number, TaxableIncome>();
  const blank = (): TaxableIncome => ({
    shortTermGains: 0,
    shortTermLosses: 0,
    longTermGains: 0,
    longTermLosses: 0,
    qualifiedDividends: 0,
    ordinaryDividends: 0,
    interestIncome: 0,
  });

  for (const e of events) {
    const year = e.closeDate.getUTCFullYear();
    const acc = out.get(year) ?? blank();

    switch (e.incomeKind) {
      case 'capital-gain':
        if (e.termType === 'long') {
          if (e.gain >= 0) acc.longTermGains += e.gain;
          else acc.longTermLosses += -e.gain;
        } else {
          if (e.gain >= 0) acc.shortTermGains += e.gain;
          else acc.shortTermLosses += -e.gain;
        }
        break;
      case 'qualified-dividend':
        acc.qualifiedDividends += e.proceeds;
        break;
      case 'ordinary-dividend':
        acc.ordinaryDividends += e.proceeds;
        break;
      case 'interest':
        acc.interestIncome += e.proceeds;
        break;
    }

    out.set(year, acc);
  }

  return out;
}

/**
 * Computes the tax bill for a single year's {@link TaxableIncome}.
 *
 * Steps:
 * 1. Net each capital-gain bucket: `netShort = shortTermGains - shortTermLosses`,
 *    `netLong = longTermGains - longTermLosses`.
 * 2. Apply {@link crossOffset} to get `taxableShort`, `taxableLong`,
 *    `ordinaryOffset`, and `carryForward`.
 * 3. `ordinaryPortion = (taxableShort + ordinaryDividends + interestIncome) * shortTerm`.
 * 4. `ltPortion = (taxableLong + qualifiedDividends) * longTerm`.
 * 5. `total = ordinaryPortion + ltPortion`.
 *
 * **Critical invariant:** capital losses do **not** offset `qualifiedDividends`.
 * Qualified dividends are added to the LT pool *after* cross-offset, at their
 * full value, so a LT capital loss that wipes out `taxableLong` to zero still
 * leaves the qualified dividend income fully taxable at the LT rate.
 *
 * `carryForward` is surfaced as a return field for the caller to track across
 * years; this function does **not** consume carry-forward from prior years
 * (cross-year carry is V3 work).
 *
 * @param income - Year-level taxable income, as produced by {@link aggregateByYear}.
 * @param rates  - `{ shortTerm, longTerm }` tax rates as decimals (e.g. `0.37`).
 * @returns `{ total, breakdown: { ordinaryPortion, ltPortion, carryForward } }`.
 */
export function computeTaxBill(
  income: TaxableIncome,
  rates: TaxRates,
): { total: number; breakdown: { ordinaryPortion: number; ltPortion: number; carryForward: number } } {
  const netShort = income.shortTermGains - income.shortTermLosses;
  const netLong = income.longTermGains - income.longTermLosses;
  const off = crossOffset(netShort, netLong);

  // Qualified dividends pool with LT gains; capital losses NEVER offset them.
  const ordinaryPortion = (off.taxableShort + income.ordinaryDividends + income.interestIncome) * rates.shortTerm;
  const ltPortion = (off.taxableLong + income.qualifiedDividends) * rates.longTerm;
  const total = ordinaryPortion + ltPortion;

  return { total, breakdown: { ordinaryPortion, ltPortion, carryForward: off.carryForward } };
}
