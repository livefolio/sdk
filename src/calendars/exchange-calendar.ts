import { DateTime } from 'luxon';
import type { Calendar, Session, TimeOfDay } from '../interfaces/calendar';
import type { DateRange } from '../interfaces/types';
import {
  resolveHolidays,
  resolveSpecialCloses,
  resolveSpecialOpens,
  type HolidayRule,
  type SpecialClose,
  type SpecialOpen,
  type AdhocTimeOverrides,
} from './holiday-rules';

const MS_PER_DAY = 86_400_000;

const DEFAULT_WEEKMASK: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);
const EMPTY_ADHOC: AdhocTimeOverrides = new Map();

function ymdKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Abstract base class for exchange trading calendars. Implements the full
 * {@link Calendar} interface by composing up to nine overridable hooks that
 * subclasses provide. Concrete implementations ship for {@link NYSEExchangeCalendar}
 * and {@link LSEExchangeCalendar}; additional exchanges can be added by
 * extending this class.
 *
 * **Per-year caching**: holiday sets and special-session maps are computed once
 * per calendar year and stored in private Maps, so repeated calls to `isOpen`,
 * `next`, or `sessions` within the same year are cheap.
 *
 * **Hook resolution order** (adhoc beats rule, rule beats regular):
 * 1. `adhocHolidays()` / `specialClosesAdhoc()` / `specialOpensAdhoc()` —
 *    `YYYY-MM-DD` string sets/maps populated once at first access.
 * 2. `regularHolidays()` / `specialCloses()` / `specialOpens()` —
 *    year-derived rule arrays applied per year via the resolver helpers.
 * 3. `regularOpen(date)` / `regularClose(date)` / `weekmask(date)` —
 *    per-date fallbacks that subclasses override to encode era-varying session
 *    times and trading-day sets.
 *
 * **Extending**: override only the hooks you need. All hooks have no-op / sensible
 * defaults (Mon–Fri weekmask, 09:30–16:00 session) so a minimal subclass need
 * only set `name`, `tz`, and `regularHolidays()`.
 */
export abstract class ExchangeCalendar implements Calendar {
  /** Short exchange name used as the registry key in {@link getCalendar}. */
  abstract readonly name: string;
  /** IANA timezone identifier, e.g. `'America/New_York'` or `'Europe/London'`. */
  abstract readonly tz: string;

  private readonly holidayCache = new Map<number, Set<number>>();
  private readonly specialCloseCache = new Map<number, Map<number, TimeOfDay>>();
  private readonly specialOpenCache = new Map<number, Map<number, TimeOfDay>>();

  private adhocHolidaysCache: ReadonlySet<string> | null = null;
  private adhocSpecialClosesCache: AdhocTimeOverrides | null = null;
  private adhocSpecialOpensCache: AdhocTimeOverrides | null = null;

  // --- Hooks ---

  /**
   * Returns the ordered list of year-derived holiday rules for this exchange.
   * The base implementation returns an empty array (no regular holidays). Override
   * to supply the full rule set; each {@link HolidayRule} in the array is applied
   * via {@link resolveHolidays} once per calendar year and cached. Rules may be
   * era-bounded via `validFrom` / `validUntil`.
   */
  protected regularHolidays(): ReadonlyArray<HolidayRule> {
    return [];
  }

  /**
   * Returns the set of `YYYY-MM-DD` strings for one-off full-day closures that
   * do not fit a repeating rule (e.g. presidential funerals, natural disasters).
   * The base implementation returns an empty set. Override with the complete
   * historical adhoc list for the exchange. This method is called at most once
   * per `ExchangeCalendar` instance; the result is cached.
   */
  protected adhocHolidays(): ReadonlySet<string> {
    return new Set();
  }

  /**
   * Returns the ordered list of year-derived early-close rules for this exchange.
   * The base implementation returns an empty array. Override to supply rules such
   * as "day after Thanksgiving closes at 13:00". Results are computed once per
   * year and cached; each rule is applied via {@link resolveSpecialCloses}.
   */
  protected specialCloses(): ReadonlyArray<SpecialClose> {
    return [];
  }

  /**
   * Returns the map of `YYYY-MM-DD` strings to override close times for
   * one-off early-close days that do not fit a repeating rule. The base
   * implementation returns an empty map. Override with the historical adhoc
   * set for the exchange. Called at most once per instance; result is cached.
   */
  protected specialClosesAdhoc(): AdhocTimeOverrides {
    return EMPTY_ADHOC;
  }

  /**
   * Returns the ordered list of year-derived late-open rules for this exchange.
   * The base implementation returns an empty array. Override to supply rules such
   * as "delayed open due to a moment of silence". Results are computed once per
   * year and cached; each rule is applied via {@link resolveSpecialOpens}.
   */
  protected specialOpens(): ReadonlyArray<SpecialOpen> {
    return [];
  }

  /**
   * Returns the map of `YYYY-MM-DD` strings to override open times for
   * one-off late-open days that do not fit a repeating rule. The base
   * implementation returns an empty map. Override with the historical adhoc
   * set for the exchange. Called at most once per instance; result is cached.
   */
  protected specialOpensAdhoc(): AdhocTimeOverrides {
    return EMPTY_ADHOC;
  }

  /**
   * Returns the default open time in local exchange time for `date` when no
   * special-open rule matches. The base implementation returns 09:30. Override
   * to encode era-varying session times (e.g. NYSE opened at 10:00 before
   * 1985-09-30).
   *
   * @param date - UTC midnight `Date` for the trading day being queried.
   */
  protected regularOpen(_date: Date): TimeOfDay {
    return { h: 9, m: 30 };
  }

  /**
   * Returns the default close time in local exchange time for `date` when no
   * special-close rule matches. The base implementation returns 16:00. Override
   * to encode era-varying session times (e.g. NYSE closed at 15:00 before
   * 1952-09-29, and at 15:30 until 1974-01-02).
   *
   * @param date - UTC midnight `Date` for the trading day being queried.
   */
  protected regularClose(_date: Date): TimeOfDay {
    return { h: 16, m: 0 };
  }

  /**
   * Returns the set of weekday indices (using `Date.getUTCDay()` convention:
   * 0 = Sunday, 1 = Monday, …, 6 = Saturday) that are regular trading days.
   * The base implementation returns `{1, 2, 3, 4, 5}` (Mon–Fri). Override to
   * encode historical six-day trading weeks (e.g. NYSE traded Mon–Sat before
   * 1952-09-29, keyed by `date` so the shift is era-aware).
   *
   * @param date - UTC midnight `Date` for the day being tested.
   */
  protected weekmask(_date: Date): ReadonlySet<number> {
    return DEFAULT_WEEKMASK;
  }

  // --- Adhoc caching getters ---
  private getAdhocHolidays(): ReadonlySet<string> {
    if (this.adhocHolidaysCache === null) this.adhocHolidaysCache = this.adhocHolidays();
    return this.adhocHolidaysCache;
  }
  private getAdhocSpecialCloses(): AdhocTimeOverrides {
    if (this.adhocSpecialClosesCache === null) this.adhocSpecialClosesCache = this.specialClosesAdhoc();
    return this.adhocSpecialClosesCache;
  }
  private getAdhocSpecialOpens(): AdhocTimeOverrides {
    if (this.adhocSpecialOpensCache === null) this.adhocSpecialOpensCache = this.specialOpensAdhoc();
    return this.adhocSpecialOpensCache;
  }

  // --- Caches ---
  /**
   * Cached lookup of regular-holiday timestamps for the given year.
   * Assumes `regularHolidays()` returns the same rule list on every call.
   */
  private holidaysForYear(year: number): Set<number> {
    let set = this.holidayCache.get(year);
    if (!set) {
      set = resolveHolidays(this.regularHolidays(), year);
      this.holidayCache.set(year, set);
    }
    return set;
  }

  private specialClosesForYear(year: number): Map<number, TimeOfDay> {
    let map = this.specialCloseCache.get(year);
    if (!map) {
      map = resolveSpecialCloses(this.specialCloses(), year);
      this.specialCloseCache.set(year, map);
    }
    return map;
  }

  private specialOpensForYear(year: number): Map<number, TimeOfDay> {
    let map = this.specialOpenCache.get(year);
    if (!map) {
      map = resolveSpecialOpens(this.specialOpens(), year);
      this.specialOpenCache.set(year, map);
    }
    return map;
  }

  private normalize(t: Date): Date {
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  }

  // --- Public Calendar API ---

  /** Returns `true` when `t` falls on a regular trading day (weekmask check, then holiday check). */
  isOpen(t: Date): boolean {
    const d = this.normalize(t);
    if (!this.weekmask(d).has(d.getUTCDay())) return false;
    if (this.getAdhocHolidays().has(ymdKey(d))) return false;
    const year = d.getUTCFullYear();
    if (this.holidaysForYear(year).has(d.getTime())) return false;
    return true;
  }

  /** Returns the first trading day strictly after `t`. */
  next(t: Date): Date {
    let d = new Date(this.normalize(t).getTime() + MS_PER_DAY);
    while (!this.isOpen(d)) d = new Date(d.getTime() + MS_PER_DAY);
    return d;
  }

  /** Returns the first trading day strictly before `t`. */
  previous(t: Date): Date {
    let d = new Date(this.normalize(t).getTime() - MS_PER_DAY);
    while (!this.isOpen(d)) d = new Date(d.getTime() - MS_PER_DAY);
    return d;
  }

  /**
   * Returns UTC midnight `Date` objects for every trading day in
   * `[range.from, range.to)`. The `from` bound is inclusive; `to` is exclusive.
   */
  sessions(range: DateRange): ReadonlyArray<Date> {
    const out: Date[] = [];
    let d = this.normalize(range.from);
    const end = this.normalize(range.to).getTime();
    while (d.getTime() < end) {
      if (this.isOpen(d)) out.push(d);
      d = new Date(d.getTime() + MS_PER_DAY);
    }
    return out;
  }

  schedule(range: DateRange): ReadonlyArray<Session> {
    const days = this.sessions(range);
    return days.map((date) => ({
      date,
      open: this.localizedTimestamp(date, this.openTimeFor(date)),
      close: this.localizedTimestamp(date, this.closeTimeFor(date)),
    }));
  }

  isEarlyClose(t: Date): boolean {
    const d = this.normalize(t);
    if (!this.isOpen(d)) return false;
    if (this.getAdhocSpecialCloses().has(ymdKey(d))) return true;
    return this.specialClosesForYear(d.getUTCFullYear()).has(d.getTime());
  }

  // --- Resolution ---
  /** Adhoc overrides win over rule-driven; both win over `regularOpen(date)`. */
  private openTimeFor(date: Date): TimeOfDay {
    const adhoc = this.getAdhocSpecialOpens().get(ymdKey(date));
    if (adhoc) return adhoc;
    const ruled = this.specialOpensForYear(date.getUTCFullYear()).get(date.getTime());
    if (ruled) return ruled;
    return this.regularOpen(date);
  }

  /** Adhoc overrides win over rule-driven; both win over `regularClose(date)`. */
  private closeTimeFor(date: Date): TimeOfDay {
    const adhoc = this.getAdhocSpecialCloses().get(ymdKey(date));
    if (adhoc) return adhoc;
    const ruled = this.specialClosesForYear(date.getUTCFullYear()).get(date.getTime());
    if (ruled) return ruled;
    return this.regularClose(date);
  }

  private localizedTimestamp(date: Date, time: TimeOfDay): Date {
    const dt = DateTime.fromObject(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: time.h,
        minute: time.m,
      },
      { zone: this.tz },
    );
    return new Date(dt.toUTC().toMillis());
  }
}
