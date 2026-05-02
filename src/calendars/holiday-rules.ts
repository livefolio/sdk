import type { TimeOfDay } from '../interfaces/calendar';

const MS_PER_DAY = 86_400_000;

export type { TimeOfDay };

/**
 * A year-derived holiday rule consumed by {@link ExchangeCalendar}. The rule
 * is active only for years in the range `[validFrom, validUntil]` (both
 * inclusive; omit either bound to leave it open).
 *
 * `resolve(year)` returns the UTC midnight `Date` for the holiday in that year,
 * or `null` if the holiday does not occur that year (e.g. a conditional rule
 * for Good Friday in certain years). When `observe` is `true`, a Saturday
 * result is moved to Friday and a Sunday result is moved to Monday (standard
 * US-style holiday observation).
 */
export type HolidayRule = {
  /** Human-readable name, used for debugging and logging. */
  name: string;
  /** Returns the UTC midnight `Date` for this holiday in `year`, or `null` to skip. */
  resolve: (year: number) => Date | null;
  /** First year (inclusive) this rule applies. Defaults to −∞. */
  validFrom?: number;
  /** Last year (inclusive) this rule applies. Defaults to +∞. */
  validUntil?: number;
  /** When `true`, Saturday dates are moved to Friday, Sunday dates to Monday. */
  observe?: boolean;
};

/**
 * A year-derived early-close rule consumed by {@link ExchangeCalendar}. Follows
 * the same validity bounds and `resolve` contract as {@link HolidayRule}, but
 * instead of marking a day closed entirely it overrides the session close time
 * to `closeAt` for the matched date.
 */
export type SpecialClose = {
  /** Human-readable name, used for debugging and logging. */
  name: string;
  /** Returns the UTC midnight `Date` for this early-close day in `year`, or `null` to skip. */
  resolve: (year: number) => Date | null;
  /** The overridden close time in local exchange time. */
  closeAt: TimeOfDay;
  /** First year (inclusive) this rule applies. Defaults to −∞. */
  validFrom?: number;
  /** Last year (inclusive) this rule applies. Defaults to +∞. */
  validUntil?: number;
};

/**
 * A year-derived late-open rule consumed by {@link ExchangeCalendar}. Follows
 * the same validity bounds and `resolve` contract as {@link HolidayRule}, but
 * overrides the session open time to `openAt` for the matched date.
 */
export type SpecialOpen = {
  /** Human-readable name, used for debugging and logging. */
  name: string;
  /** Returns the UTC midnight `Date` for this late-open day in `year`, or `null` to skip. */
  resolve: (year: number) => Date | null;
  /** The overridden open time in local exchange time. */
  openAt: TimeOfDay;
  /** First year (inclusive) this rule applies. Defaults to −∞. */
  validFrom?: number;
  /** Last year (inclusive) this rule applies. Defaults to +∞. */
  validUntil?: number;
};

/**
 * Map of `YYYY-MM-DD` date strings to override times. Used for one-off
 * historical specials (e.g. a single early close due to a snowstorm) that do
 * not fit a repeating year-derived rule. Keys must be in `YYYY-MM-DD` format
 * in UTC.
 */
export type AdhocTimeOverrides = ReadonlyMap<string, TimeOfDay>;

/**
 * Era-bounded session-time rule. Lookup picks the latest rule with `effectiveFrom ≤ date`.
 * Use `effectiveFrom: undefined` for the default (since-inception) rule.
 */
export type SessionTimeRule = {
  effectiveFrom?: string; // YYYY-MM-DD inclusive
  time: TimeOfDay;
};

/**
 * Returns the UTC midnight `Date` of the nth occurrence of `weekday` in the
 * given `month` and `year`. `weekday` follows `Date.getUTCDay()` convention
 * (0 = Sunday, 1 = Monday, …, 6 = Saturday). `n` is 1-based.
 *
 * Example: 3rd Monday of January 2024 → `nthWeekdayOfMonth(2024, 1, 1, 3)`.
 */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7));
}

/**
 * Returns the UTC midnight `Date` of the last occurrence of `weekday` in the
 * given `month` and `year`. `weekday` follows `Date.getUTCDay()` convention.
 *
 * Example: last Monday of May 2024 → `lastWeekdayOfMonth(2024, 5, 1)`.
 */
export function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(last.getTime() - offset * MS_PER_DAY);
}

/**
 * Computes the UTC midnight `Date` of Easter Sunday for the given Gregorian
 * `year` using the Anonymous Gregorian algorithm (also known as the "Meeus/Jones/Butcher"
 * algorithm). Valid for years 1583–4099.
 */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const month = Math.floor((h + L - 7 * m + 114) / 31);
  const day = ((h + L - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Applies Saturday → Friday, Sunday → Monday observation to a holiday date.
 * Weekday dates are returned unchanged. Used when a {@link HolidayRule} has
 * `observe: true`.
 */
export function observed(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return new Date(d.getTime() - MS_PER_DAY);
  if (dow === 0) return new Date(d.getTime() + MS_PER_DAY);
  return d;
}

/**
 * Applies a list of {@link HolidayRule} definitions to a single `year` and
 * returns a `Set` of UTC millisecond timestamps for all holidays active that
 * year. Rules outside their `[validFrom, validUntil]` bounds are skipped.
 * Rules that return `null` from `resolve` are also skipped.
 */
export function resolveHolidays(rules: ReadonlyArray<HolidayRule>, year: number): Set<number> {
  const out = new Set<number>();
  for (const rule of rules) {
    if (rule.validFrom !== undefined && year < rule.validFrom) continue;
    if (rule.validUntil !== undefined && year > rule.validUntil) continue;
    const raw = rule.resolve(year);
    if (raw === null) continue;
    const final = rule.observe ? observed(raw) : raw;
    out.add(final.getTime());
  }
  return out;
}

/**
 * Applies a list of {@link SpecialClose} rules to a single `year` and returns
 * a map from UTC millisecond timestamp to override close time. Rules outside
 * their `[validFrom, validUntil]` bounds and rules that return `null` from
 * `resolve` are skipped.
 */
export function resolveSpecialCloses(rules: ReadonlyArray<SpecialClose>, year: number): Map<number, TimeOfDay> {
  const out = new Map<number, TimeOfDay>();
  for (const rule of rules) {
    if (rule.validFrom !== undefined && year < rule.validFrom) continue;
    if (rule.validUntil !== undefined && year > rule.validUntil) continue;
    const d = rule.resolve(year);
    if (d === null) continue;
    out.set(d.getTime(), rule.closeAt);
  }
  return out;
}

/**
 * Applies a list of {@link SpecialOpen} rules to a single `year` and returns
 * a map from UTC millisecond timestamp to override open time. Rules outside
 * their `[validFrom, validUntil]` bounds and rules that return `null` from
 * `resolve` are skipped.
 */
export function resolveSpecialOpens(rules: ReadonlyArray<SpecialOpen>, year: number): Map<number, TimeOfDay> {
  const out = new Map<number, TimeOfDay>();
  for (const rule of rules) {
    if (rule.validFrom !== undefined && year < rule.validFrom) continue;
    if (rule.validUntil !== undefined && year > rule.validUntil) continue;
    const d = rule.resolve(year);
    if (d === null) continue;
    out.set(d.getTime(), rule.openAt);
  }
  return out;
}

// ─── pandas-equivalent date helpers ─────────────────────────────────────────
// These are general-purpose calendar utilities modelled on pandas_market_calendars
// helpers. They are exchange-agnostic and reused across NYSE, LSE, and future ports.

/** pandas `sunday_to_monday`: only Sunday observation; Saturday stays Saturday. */
export function sundayToMonday(d: Date): Date {
  return d.getUTCDay() === 0 ? new Date(d.getTime() + MS_PER_DAY) : d;
}

/** pandas `nearest_workday`: Sat → Friday, Sun → Monday, weekday → unchanged. */
export function nearestWorkday(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return new Date(d.getTime() - MS_PER_DAY);
  if (dow === 0) return new Date(d.getTime() + MS_PER_DAY);
  return d;
}

/**
 * First Monday on/after the given day of the month (mimics pandas `weekday=MO(n)` offset).
 * Pass `nth > 1` to skip forward that many additional weeks.
 */
export function firstMondayOnOrAfter(year: number, month: number, day: number, nth = 1): Date {
  const start = new Date(Date.UTC(year, month - 1, day));
  const offset = (1 - start.getUTCDay() + 7) % 7; // MON = 1
  return new Date(start.getTime() + (offset + 7 * (nth - 1)) * MS_PER_DAY);
}

/** Easter offset by `dayDelta` days (e.g. Good Friday = easterPlus(y, -2)). */
export function easterPlus(year: number, dayDelta: number): Date {
  return new Date(easter(year).getTime() + dayDelta * MS_PER_DAY);
}

/** Helper to drop a holiday if its observed date falls outside an allowed weekday set. */
export function dropIfNotInDays(d: Date | null, allowed: ReadonlySet<number>): Date | null {
  if (d === null) return null;
  return allowed.has(d.getUTCDay()) ? d : null;
}

/**
 * Pick the rule with the latest `effectiveFrom ≤ date.toISOString().slice(0,10)`.
 * Rules without `effectiveFrom` are treated as the default (since inception).
 * Throws if no rule matches at all (provide a default rule to guarantee a match).
 */
export function resolveSessionTime(rules: ReadonlyArray<SessionTimeRule>, date: Date): TimeOfDay {
  const key = date.toISOString().slice(0, 10);
  let best: SessionTimeRule | null = null;
  for (const rule of rules) {
    if (rule.effectiveFrom === undefined) {
      if (best === null) best = rule;
      continue;
    }
    if (rule.effectiveFrom <= key) {
      if (best === null || best.effectiveFrom === undefined || best.effectiveFrom < rule.effectiveFrom) {
        best = rule;
      }
    }
  }
  if (best === null) {
    throw new Error('resolveSessionTime: no matching rule (provide a default rule with no effectiveFrom)');
  }
  return best.time;
}
