import { ExchangeCalendar } from './exchange-calendar';
import {
  dropIfNotInDays,
  easterPlus,
  firstMondayOnOrAfter,
  lastWeekdayOfMonth,
  type AdhocTimeOverrides,
  type HolidayRule,
  type SpecialClose,
  type SpecialOpen,
} from './holiday-rules';
import type { TimeOfDay } from '../interfaces/calendar';

const MS_PER_DAY = 86_400_000;

// Day-of-week constants matching JS Date.getUTCDay(): Sun=0, Mon=1, ..., Sat=6.
const SUN = 0;
const MON = 1;
const TUE = 2;
const SAT = 6;

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

const WEEKDAYS_MON_FRI: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);
const MON_TUE: ReadonlySet<number> = new Set([MON, TUE]);

/**
 * pandas `weekend_to_monday`: Sat → Monday, Sun → Monday. Weekday → unchanged.
 * Used by LSE for New Year's Day observance.
 */
function weekendToMonday(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === SAT) return new Date(d.getTime() + 2 * MS_PER_DAY);
  if (dow === SUN) return new Date(d.getTime() + MS_PER_DAY);
  return d;
}

/**
 * pandas `previous_friday`: if Sat → Friday (−1 day); if Sun → Friday (−2 days);
 * weekday → unchanged. Used by LSE for Christmas Eve and New Year's Eve early-close
 * observance — the early close moves to the prior Friday when the calendar date
 * falls on a weekend.
 */
function previousFriday(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === SAT) return new Date(d.getTime() - MS_PER_DAY);
  if (dow === SUN) return new Date(d.getTime() - 2 * MS_PER_DAY);
  return d;
}

// ─── Regular holidays ───────────────────────────────────────────────────────
// Faithful port of pandas_market_calendars/holidays/uk.py rule definitions.
const REGULAR_HOLIDAYS: ReadonlyArray<HolidayRule> = [
  // ── New Year's Day ─────────────────────────────────────────────────────────
  // pandas: weekend_to_monday observance (Sat → Mon, Sun → Mon).
  {
    name: "New Year's Day",
    resolve: (y) => weekendToMonday(utcDate(y, 1, 1)),
  },

  // ── Good Friday (easter − 2) ───────────────────────────────────────────────
  {
    name: 'Good Friday',
    resolve: (y) => easterPlus(y, -2),
  },

  // ── Easter Monday (easter + 1) ─────────────────────────────────────────────
  {
    name: 'Easter Monday',
    resolve: (y) => easterPlus(y, 1),
  },

  // ── Early May Bank Holiday — first Monday of May ───────────────────────────
  // Upstream splits this into three eras to remove May 4 1995 and May 4 2020,
  // which were displaced for VE-Day anniversaries.
  {
    name: 'Early May Bank Holiday (pre-1995)',
    validUntil: 1994,
    resolve: (y) => firstMondayOnOrAfter(y, 5, 1),
  },
  {
    name: 'Early May Bank Holiday (1996-2019)',
    validFrom: 1996,
    validUntil: 2019,
    resolve: (y) => firstMondayOnOrAfter(y, 5, 1),
  },
  {
    name: 'Early May Bank Holiday (2021+)',
    validFrom: 2021,
    resolve: (y) => firstMondayOnOrAfter(y, 5, 1),
  },

  // ── Spring Bank Holiday — last Monday of May ───────────────────────────────
  // Upstream splits to skip the regular Spring Bank in 2002 (Golden Jubilee),
  // 2012 (Diamond Jubilee), and 2022 (Platinum Jubilee). Those years have
  // adhoc Jubilee closures that replace it.
  {
    name: 'Spring Bank Holiday (pre-2002)',
    validUntil: 2001,
    resolve: (y) => lastWeekdayOfMonth(y, 5, MON),
  },
  {
    name: 'Spring Bank Holiday (2003-2011)',
    validFrom: 2003,
    validUntil: 2011,
    resolve: (y) => lastWeekdayOfMonth(y, 5, MON),
  },
  {
    name: 'Spring Bank Holiday (2013-2021)',
    validFrom: 2013,
    validUntil: 2021,
    resolve: (y) => lastWeekdayOfMonth(y, 5, MON),
  },
  {
    name: 'Spring Bank Holiday (2023+)',
    validFrom: 2023,
    resolve: (y) => lastWeekdayOfMonth(y, 5, MON),
  },

  // ── Summer Bank Holiday — last Monday of August ────────────────────────────
  {
    name: 'Summer Bank Holiday',
    resolve: (y) => lastWeekdayOfMonth(y, 8, MON),
  },

  // ── Christmas Day (Dec 25) ─────────────────────────────────────────────────
  // pandas Holiday with no observance — the literal Dec 25 is added; if it
  // falls on a weekend the WeekendChristmas rule below adds a substitute Mon/Tue.
  {
    name: 'Christmas Day',
    resolve: (y) => utcDate(y, 12, 25),
  },

  // ── Weekend Christmas substitute (Dec 27, only Mon/Tue) ────────────────────
  // If Dec 25 is Sat → Dec 27 is Mon (substitute Christmas).
  // If Dec 25 is Sun → Dec 27 is Tue (substitute Christmas, after Boxing Day Mon Dec 26).
  {
    name: 'Weekend Christmas',
    resolve: (y) => dropIfNotInDays(utcDate(y, 12, 27), MON_TUE),
  },

  // ── Boxing Day (Dec 26) ────────────────────────────────────────────────────
  {
    name: 'Boxing Day',
    resolve: (y) => utcDate(y, 12, 26),
  },

  // ── Weekend Boxing Day substitute (Dec 28, only Mon/Tue) ───────────────────
  // If Dec 26 is Sat → Dec 28 is Mon (substitute Boxing).
  // If Dec 26 is Sun → Dec 28 is Tue (substitute Boxing, after Christmas observed Mon Dec 27).
  {
    name: 'Weekend Boxing Day',
    resolve: (y) => dropIfNotInDays(utcDate(y, 12, 28), MON_TUE),
  },
];

// ─── Adhoc full-day closures ────────────────────────────────────────────────
// Sourced verbatim from pandas_market_calendars/holidays/uk.py UniqueCloses.
const ADHOC_HOLIDAYS: ReadonlySet<string> = new Set<string>([
  // VE-Day anniversaries (Early May Bank Holiday displaced)
  '1995-05-08', // 50th anniversary
  '2020-05-08', // 75th anniversary

  // Queen Elizabeth II Jubilees
  '1977-06-07', // Silver Jubilee
  '2002-06-03', // Golden Jubilee — Spring Bank holiday moved
  '2002-06-04', // Golden Jubilee — additional
  '2012-06-04', // Diamond Jubilee — Spring Bank holiday moved
  '2012-06-05', // Diamond Jubilee — additional
  '2022-06-02', // Platinum Jubilee — Spring Bank holiday moved
  '2022-06-03', // Platinum Jubilee — additional

  // State funerals
  '2022-09-19', // Queen Elizabeth II

  // Royal weddings
  '1973-11-14', // Princess Anne and Mark Phillips
  '1981-07-29', // Prince Charles and Diana Spencer
  '2011-04-29', // Prince William and Catherine Middleton

  // Coronation of King Charles III
  '2023-05-08',

  // Miscellaneous
  '1999-12-31', // Eve of 3rd Millennium A.D.
]);

// ─── Rule-driven special closes (12:30 early close) ─────────────────────────
// Upstream LSE: ChristmasEve and LSENewYearsEve — both use `previous_friday`
// observance, so when Dec 24 / Dec 31 falls on a weekend the early close moves
// to the prior Friday (a regular trading day). Modern session close is 16:30
// so a 12:30 close is genuinely early.
const SPECIAL_CLOSES: ReadonlyArray<SpecialClose> = [
  {
    name: 'Christmas Eve early close',
    closeAt: { h: 12, m: 30 },
    resolve: (y) => dropIfNotInDays(previousFriday(utcDate(y, 12, 24)), WEEKDAYS_MON_FRI),
  },
  {
    name: "New Year's Eve early close",
    closeAt: { h: 12, m: 30 },
    resolve: (y) => dropIfNotInDays(previousFriday(utcDate(y, 12, 31)), WEEKDAYS_MON_FRI),
  },
];

// ─── Adhoc special closes (literal) ─────────────────────────────────────────
// Upstream LSE has no adhoc early-close map.
const SPECIAL_CLOSES_ADHOC: AdhocTimeOverrides = new Map<string, TimeOfDay>();

// ─── Special opens — none in upstream LSE ───────────────────────────────────
const SPECIAL_OPENS: ReadonlyArray<SpecialOpen> = [];
const SPECIAL_OPENS_ADHOC: AdhocTimeOverrides = new Map<string, TimeOfDay>();

/**
 * London Stock Exchange (LSE) trading-day calendar. Faithful port of
 * `pandas_market_calendars`' `lse.py` and `holidays/uk.py`. Historical
 * coverage begins 1801-01-01, aligned with the start of the modern exchange
 * after the Banking and Financial Dealings Act 1971 codified the current
 * bank-holiday framework.
 *
 * **Session**: 08:00–16:30 Europe/London. The exchange observes BST (UTC+1)
 * in summer and GMT (UTC+0) in winter — DST handling is delegated to luxon via
 * the `Europe/London` IANA timezone, so wall-clock session times are stable
 * across the DST transition while their UTC equivalents shift by one hour.
 *
 * **Early closes**: Christmas Eve (Dec 24) and New Year's Eve (Dec 31) close
 * at 12:30. Both use `previous_friday` observance — when the calendar date
 * falls on a weekend, the early close moves to the prior Friday.
 *
 * **Era boundaries**: bank-holiday exceptions for Royal Jubilees and VE-Day
 * anniversaries are implemented by splitting affected `Spring Bank Holiday`
 * and `Early May Bank Holiday` rules into era-bounded shards (matching
 * upstream `start_date` / `end_date` markers) and adding the displaced dates
 * as adhoc closures.
 */
export class LSEExchangeCalendar extends ExchangeCalendar {
  readonly name = 'LSE';
  readonly tz = 'Europe/London';

  protected override regularHolidays(): ReadonlyArray<HolidayRule> {
    return REGULAR_HOLIDAYS;
  }

  protected override adhocHolidays(): ReadonlySet<string> {
    return ADHOC_HOLIDAYS;
  }

  protected override specialCloses(): ReadonlyArray<SpecialClose> {
    return SPECIAL_CLOSES;
  }

  protected override specialClosesAdhoc(): AdhocTimeOverrides {
    return SPECIAL_CLOSES_ADHOC;
  }

  protected override specialOpens(): ReadonlyArray<SpecialOpen> {
    return SPECIAL_OPENS;
  }

  protected override specialOpensAdhoc(): AdhocTimeOverrides {
    return SPECIAL_OPENS_ADHOC;
  }

  protected override regularOpen(_date: Date): TimeOfDay {
    return { h: 8, m: 0 };
  }

  protected override regularClose(_date: Date): TimeOfDay {
    return { h: 16, m: 30 };
  }

  protected override weekmask(_date: Date): ReadonlySet<number> {
    return WEEKDAYS_MON_FRI;
  }
}
