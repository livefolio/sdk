import type { DateRange } from './types';

/**
 * Wall-clock time of day, expressed in local exchange time.
 *
 * @example
 * ```ts
 * import type { TimeOfDay } from '@livefolio/sdk';
 *
 * const marketOpen: TimeOfDay = { h: 9, m: 30 };  // 09:30 NYSE
 * const earlyClose: TimeOfDay = { h: 13, m: 0 };  // 13:00 on early-close days
 * ```
 */
export type TimeOfDay = { h: number; m: number };

/**
 * The open and close instants for a single trading session.
 *
 * `date` is midnight of the session day (used as a stable key).
 * `open` and `close` are the exact UTC instants the exchange accepts orders.
 *
 * @example
 * ```ts
 * import type { Session } from '@livefolio/sdk';
 *
 * // A normal NYSE session
 * const session: Session = {
 *   date:  new Date('2024-06-03'),
 *   open:  new Date('2024-06-03T13:30:00Z'), // 09:30 ET in UTC
 *   close: new Date('2024-06-03T20:00:00Z'), // 16:00 ET in UTC
 * };
 * ```
 */
export type Session = { date: Date; open: Date; close: Date };

/**
 * Exchange calendar — the single source of truth for trading-day arithmetic.
 *
 * Implementations MUST guarantee:
 * - `isOpen(t)` returns `true` only for instants strictly within a session
 *   `[session.open, session.close)`.
 * - `next(t)` returns the midnight-UTC Date of the **next** trading day after
 *   `t`; it MUST never return a weekend or holiday.
 * - `previous(t)` is the symmetric inverse of `next`.
 * - `sessions(range)` returns one Date per trading day in the half-open
 *   interval `[range.from, range.to)`, in ascending order.
 * - `schedule(range)` returns the same dates as `sessions` but enriched with
 *   `open`/`close` instants for each session.
 * - `isEarlyClose(t)` returns `true` if the session containing (or nearest to)
 *   `t` ends before the exchange's normal close time.
 *
 * Reference implementation: {@link NYSEExchangeCalendar}, {@link LSEExchangeCalendar}.
 *
 * @example
 * ```ts
 * import { NYSEExchangeCalendar } from '@livefolio/sdk';
 *
 * const cal = new NYSEExchangeCalendar();
 * const today = new Date('2024-11-29'); // Black Friday (early close)
 * console.log(cal.isEarlyClose(today)); // true
 * const next = cal.next(today);
 * console.log(next.toISOString());      // 2024-12-02T00:00:00.000Z
 * ```
 */
export interface Calendar {
  /**
   * Returns `true` if `t` falls inside an open trading session for this
   * exchange (i.e. between session open and session close, inclusive of open,
   * exclusive of close).
   *
   * @param t - The instant to test.
   */
  isOpen(t: Date): boolean;

  /**
   * Returns the midnight-UTC Date of the next trading day strictly after `t`.
   * Skips weekends, exchange holidays, and any days with no scheduled session.
   *
   * @param t - Reference date. If `t` itself is a trading day the result is
   *   the *following* trading day, not `t`.
   */
  next(t: Date): Date;

  /**
   * Returns the midnight-UTC Date of the most recent trading day strictly
   * before `t`. Symmetric inverse of {@link Calendar.next}.
   *
   * @param t - Reference date.
   */
  previous(t: Date): Date;

  /**
   * Returns the trading days (as midnight-UTC Dates) within the half-open
   * interval `[range.from, range.to)`, in ascending order.
   *
   * @param range - Half-open date range; `range.from` is inclusive, `range.to`
   *   is exclusive.
   * @returns Ascending array of trading-day Dates. Empty if no trading days
   *   fall in the range.
   *
   * @example
   * ```ts
   * import { NYSEExchangeCalendar } from '@livefolio/sdk';
   *
   * const cal = new NYSEExchangeCalendar();
   * const days = cal.sessions({
   *   from: new Date('2024-12-23'),
   *   to:   new Date('2025-01-02'),
   * });
   * // days.length === 5 (skips Christmas, Boxing Day is US-only partial, New Year's)
   * ```
   */
  sessions(range: DateRange): ReadonlyArray<Date>;

  /**
   * Returns full {@link Session} records (date, open instant, close instant)
   * for every trading day in the half-open interval `[range.from, range.to)`.
   *
   * @param range - Half-open date range.
   * @returns Ascending array of {@link Session} objects. Early-close days have
   *   a `close` earlier than the normal session close.
   */
  schedule(range: DateRange): ReadonlyArray<Session>;

  /**
   * Returns `true` if the exchange closes early on the day containing `t`.
   * Common examples: Black Friday (US), Christmas Eve, New Year's Eve.
   *
   * @param t - The instant or day to test.
   */
  isEarlyClose(t: Date): boolean;
}
