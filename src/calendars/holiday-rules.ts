import type { TimeOfDay } from '../interfaces/calendar';

const MS_PER_DAY = 86_400_000;

export type { TimeOfDay };

export type HolidayRule = {
  name: string;
  resolve: (year: number) => Date | null;
  validFrom?: number;
  validUntil?: number;
  observe?: boolean;
};

export type SpecialClose = {
  name: string;
  resolve: (year: number) => Date | null;
  closeAt: TimeOfDay;
  validFrom?: number;
  validUntil?: number;
};

export type SpecialOpen = {
  name: string;
  resolve: (year: number) => Date | null;
  openAt: TimeOfDay;
  validFrom?: number;
  validUntil?: number;
};

/** Map of YYYY-MM-DD → override time. Used for one-off historical specials that don't fit a year-derived rule. */
export type AdhocTimeOverrides = ReadonlyMap<string, TimeOfDay>;

/**
 * Era-bounded session-time rule. Lookup picks the latest rule with `effectiveFrom ≤ date`.
 * Use `effectiveFrom: undefined` for the default (since-inception) rule.
 */
export type SessionTimeRule = {
  effectiveFrom?: string; // YYYY-MM-DD inclusive
  time: TimeOfDay;
};

export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7));
}

export function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(last.getTime() - offset * MS_PER_DAY);
}

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

export function observed(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return new Date(d.getTime() - MS_PER_DAY);
  if (dow === 0) return new Date(d.getTime() + MS_PER_DAY);
  return d;
}

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
