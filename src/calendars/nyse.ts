import { ExchangeCalendar } from './exchange-calendar';
import {
  easter,
  lastWeekdayOfMonth,
  nthWeekdayOfMonth,
  type AdhocTimeOverrides,
  type HolidayRule,
  type SpecialClose,
  type SpecialOpen,
} from './holiday-rules';
import type { TimeOfDay } from '../interfaces/calendar';

const MS_PER_DAY = 86_400_000;

// Day-of-week constants matching JS Date.getUTCDay(): Sun=0, Mon=1, ... Sat=6.
const SUN = 0;
const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const FRI = 5;
const SAT = 6;

const SATURDAY_END_KEY = '1952-09-29'; // Saturday trading retired starting this date.

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** pandas `sunday_to_monday`: only Sunday observation; Saturday stays Saturday. */
function sundayToMonday(d: Date): Date {
  return d.getUTCDay() === SUN ? new Date(d.getTime() + MS_PER_DAY) : d;
}

/** pandas `nearest_workday`: Sat → Friday, Sun → Monday, weekday → unchanged. */
function nearestWorkday(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === SAT) return new Date(d.getTime() - MS_PER_DAY);
  if (dow === SUN) return new Date(d.getTime() + MS_PER_DAY);
  return d;
}

/** First Monday on/after the n-th day of the given month (mimics pandas `weekday=MO(n)` offset). */
function firstMondayOnOrAfter(year: number, month: number, day: number, nth = 1): Date {
  const start = utcDate(year, month, day);
  const offset = (MON - start.getUTCDay() + 7) % 7;
  return new Date(start.getTime() + (offset + 7 * (nth - 1)) * MS_PER_DAY);
}

/** Easter offset by `dayDelta` days (Good Friday = easter() - 2). */
function easterPlus(year: number, dayDelta: number): Date {
  return new Date(easter(year).getTime() + dayDelta * MS_PER_DAY);
}

/** Helper to drop a holiday if its observed date falls outside an allowed weekday set. */
function dropIfNotInDays(d: Date | null, allowed: ReadonlySet<number>): Date | null {
  if (d === null) return null;
  return allowed.has(d.getUTCDay()) ? d : null;
}

const WEEKDAYS_MON_FRI: ReadonlySet<number> = new Set([MON, TUE, WED, THU, FRI]);
const WEEKDAYS_MON_SAT: ReadonlySet<number> = new Set([MON, TUE, WED, THU, FRI, SAT]);

const REGULAR_HOLIDAYS: ReadonlyArray<HolidayRule> = [
  // ── New Year's Day ─────────────────────────────────────────────────────────
  // Post-1952: Sunday → Monday observance, Saturday-NYD drops (no Friday close).
  {
    name: "New Year's Day (post-1952)",
    validFrom: 1952,
    resolve: (y) => dropIfNotInDays(sundayToMonday(utcDate(y, 1, 1)), WEEKDAYS_MON_FRI),
  },
  // Pre-1952: Saturday is a trading day; NYD on Saturday is observed on Saturday.
  {
    name: "New Year's Day (pre-1952)",
    validUntil: 1952,
    resolve: (y) => dropIfNotInDays(sundayToMonday(utcDate(y, 1, 1)), WEEKDAYS_MON_SAT),
  },

  // ── MLK Day (3rd Mon of Jan, from 1998) ────────────────────────────────────
  {
    name: 'Martin Luther King Jr. Day',
    validFrom: 1998,
    resolve: (y) => nthWeekdayOfMonth(y, 1, MON, 3),
  },

  // ── Presidents Day (3rd Mon of Feb, from 1971) ────────────────────────────
  {
    name: 'Presidents Day',
    validFrom: 1971,
    resolve: (y) => nthWeekdayOfMonth(y, 2, MON, 3),
  },

  // ── Washington's Birthday (Feb 22) ─────────────────────────────────────────
  // Pre-1952: Mon-Sat with Sunday → Monday.
  {
    name: "Washington's Birthday (pre-1952)",
    validUntil: 1952,
    resolve: (y) => dropIfNotInDays(sundayToMonday(utcDate(y, 2, 22)), WEEKDAYS_MON_SAT),
  },
  // 1952-09-29 → 1963: Mon-Fri with Sunday → Monday.
  {
    name: "Washington's Birthday (1952-1963)",
    validFrom: 1953,
    validUntil: 1963,
    resolve: (y) => dropIfNotInDays(sundayToMonday(utcDate(y, 2, 22)), WEEKDAYS_MON_FRI),
  },
  // 1964-1970: nearest_workday observance.
  {
    name: "Washington's Birthday (1964-1970)",
    validFrom: 1964,
    validUntil: 1970,
    resolve: (y) => nearestWorkday(utcDate(y, 2, 22)),
  },

  // ── Lincoln's Birthday (Feb 12, 1896-1953) ─────────────────────────────────
  {
    name: "Lincoln's Birthday",
    validFrom: 1896,
    validUntil: 1953,
    resolve: (y) => sundayToMonday(utcDate(y, 2, 12)),
  },

  // ── Good Friday ────────────────────────────────────────────────────────────
  // Closed every year EXCEPT 1898, 1906, 1907.
  {
    name: 'Good Friday (1908+)',
    validFrom: 1908,
    resolve: (y) => easterPlus(y, -2),
  },
  {
    name: 'Good Friday (pre-1898)',
    validFrom: 1885,
    validUntil: 1897,
    resolve: (y) => easterPlus(y, -2),
  },
  {
    name: 'Good Friday (1899-1905)',
    validFrom: 1899,
    validUntil: 1905,
    resolve: (y) => easterPlus(y, -2),
  },

  // ── Memorial Day ───────────────────────────────────────────────────────────
  // Modern: last Monday of May, from 1971.
  {
    name: 'Memorial Day (modern, 1971+)',
    validFrom: 1971,
    resolve: (y) => firstMondayOnOrAfter(y, 5, 25),
  },
  // Pre-1952 (Mon-Sat with Sunday → Monday).
  {
    name: 'Memorial Day (pre-1952)',
    validUntil: 1952,
    resolve: (y) => dropIfNotInDays(sundayToMonday(utcDate(y, 5, 30)), WEEKDAYS_MON_SAT),
  },
  // 1952-09-29 → 1963.
  {
    name: 'Memorial Day (1952-1963)',
    validFrom: 1953,
    validUntil: 1963,
    resolve: (y) => dropIfNotInDays(sundayToMonday(utcDate(y, 5, 30)), WEEKDAYS_MON_FRI),
  },
  // 1964-1969 nearest_workday.
  {
    name: 'Memorial Day (1964-1969)',
    validFrom: 1964,
    validUntil: 1969,
    resolve: (y) => nearestWorkday(utcDate(y, 5, 30)),
  },

  // ── Juneteenth (from 2022) ─────────────────────────────────────────────────
  {
    name: 'Juneteenth',
    validFrom: 2022,
    resolve: (y) => nearestWorkday(utcDate(y, 6, 19)),
  },

  // ── Independence Day ───────────────────────────────────────────────────────
  // Modern: nearest_workday, from 1954.
  {
    name: 'Independence Day (modern, 1954+)',
    validFrom: 1954,
    resolve: (y) => dropIfNotInDays(nearestWorkday(utcDate(y, 7, 4)), WEEKDAYS_MON_FRI),
  },
  // Pre-1952.
  {
    name: 'Independence Day (pre-1952)',
    validUntil: 1952,
    resolve: (y) => dropIfNotInDays(sundayToMonday(utcDate(y, 7, 4)), WEEKDAYS_MON_SAT),
  },
  // 1952-09-29 → 1953 (post-Saturday-trading transition).
  {
    name: 'Independence Day (1953)',
    validFrom: 1953,
    validUntil: 1953,
    resolve: (y) => dropIfNotInDays(sundayToMonday(utcDate(y, 7, 4)), WEEKDAYS_MON_FRI),
  },

  // ── Labor Day (1st Mon of Sep, from 1887) ─────────────────────────────────
  {
    name: 'Labor Day',
    validFrom: 1887,
    resolve: (y) => nthWeekdayOfMonth(y, 9, MON, 1),
  },

  // ── Columbus Day (Oct 12, 1909-1953) ───────────────────────────────────────
  {
    name: 'Columbus Day',
    validFrom: 1909,
    validUntil: 1953,
    resolve: (y) => sundayToMonday(utcDate(y, 10, 12)),
  },

  // ── Election Day (1848-1967, every year; 1968-1980 adhoc; thereafter none) ─
  {
    name: 'Election Day (1848-1967)',
    validFrom: 1885,
    validUntil: 1967,
    resolve: (y) => {
      // First Tuesday on/after Nov 2 (pandas: month=11 day=2 offset=TU(1)).
      const start = utcDate(y, 11, 2);
      const offset = (TUE - start.getUTCDay() + 7) % 7;
      return new Date(start.getTime() + offset * MS_PER_DAY);
    },
  },

  // ── Veterans/Armistice Day (Nov 11, 1934-1953) ─────────────────────────────
  {
    name: 'Veterans Day (1934-1953)',
    validFrom: 1934,
    validUntil: 1953,
    resolve: (y) => sundayToMonday(utcDate(y, 11, 11)),
  },

  // ── Thanksgiving ───────────────────────────────────────────────────────────
  // Modern: 4th Thursday of Nov, from 1942.
  {
    name: 'Thanksgiving (modern, 1942+)',
    validFrom: 1942,
    resolve: (y) => nthWeekdayOfMonth(y, 11, THU, 4),
  },
  // Pre-1939: last Thursday of Nov.
  {
    name: 'Thanksgiving (pre-1939)',
    validFrom: 1864,
    validUntil: 1938,
    resolve: (y) => lastWeekdayOfMonth(y, 11, THU),
  },
  // 1939-1941: 2nd-to-last Thursday of Nov (Franklin Thanksgiving).
  {
    name: 'Thanksgiving (1939-1941)',
    validFrom: 1939,
    validUntil: 1941,
    resolve: (y) => {
      const last = lastWeekdayOfMonth(y, 11, THU);
      return new Date(last.getTime() - 7 * MS_PER_DAY);
    },
  },

  // ── Christmas ──────────────────────────────────────────────────────────────
  // Modern: nearest_workday, from 1999.
  {
    name: 'Christmas (1999+)',
    validFrom: 1999,
    resolve: (y) => nearestWorkday(utcDate(y, 12, 25)),
  },
  // 1954-1998.
  {
    name: 'Christmas (1954-1998)',
    validFrom: 1954,
    validUntil: 1998,
    resolve: (y) => nearestWorkday(utcDate(y, 12, 25)),
  },
  // Pre-1954: sunday_to_monday only.
  {
    name: 'Christmas (pre-1954)',
    validUntil: 1953,
    resolve: (y) => sundayToMonday(utcDate(y, 12, 25)),
  },
];

// ─── Adhoc full-day closures (literal date set) ──────────────────────────────
// Sourced verbatim from pandas_market_calendars/holidays/nyse.py adhoc lists.
const ADHOC_RAW: ReadonlyArray<string> = [
  // SatAfterGoodFridayAdhoc
  '1900-04-14',
  '1901-04-06',
  '1902-03-29',
  '1903-04-11',
  '1905-04-22',
  '1907-03-30',
  '1908-04-18',
  '1909-04-10',
  '1910-03-26',
  '1911-04-15',
  '1913-03-22',
  '1920-04-03',
  '1929-03-30',
  '1930-04-19',
  // MonBeforeIndependenceDayAdhoc
  '1899-07-03',
  // SatBeforeIndependenceDayAdhoc
  '1887-07-02',
  '1892-07-02',
  '1898-07-02',
  '1904-07-02',
  '1909-07-03',
  '1910-07-02',
  '1920-07-03',
  '1921-07-02',
  '1926-07-03',
  '1932-07-02',
  '1937-07-03',
  // SatAfterIndependenceDayAdhoc
  '1890-07-05',
  '1902-07-05',
  '1913-07-05',
  '1919-07-05',
  '1930-07-05',
  // DaysAfterIndependenceDayAdhoc
  '1901-07-05',
  '1901-07-06',
  '1968-07-05',
  // SatBeforeLaborDayAdhoc
  '1888-09-01',
  '1898-09-03',
  '1900-09-01',
  '1901-08-31',
  '1902-08-30',
  '1903-09-05',
  '1904-09-03',
  '1907-08-31',
  '1908-09-05',
  '1909-09-04',
  '1910-09-03',
  '1911-09-02',
  '1912-08-31',
  '1913-08-30',
  '1917-09-01',
  '1919-08-30',
  '1920-09-04',
  '1921-09-03',
  '1926-09-04',
  '1929-08-31',
  '1930-08-30',
  '1931-09-05',
  // USElectionDay1968to1980Adhoc
  '1968-11-05',
  '1972-11-07',
  '1976-11-02',
  '1980-11-04',
  // FridayAfterThanksgivingAdHoc
  '1888-11-30',
  // SatBeforeChristmasAdhoc
  '1887-12-24',
  '1898-12-24',
  '1904-12-24',
  '1910-12-24',
  '1911-12-23',
  '1922-12-23',
  '1949-12-24',
  '1950-12-23',
  // SatAfterChristmasAdhoc
  '1891-12-26',
  '1896-12-26',
  '1903-12-26',
  '1908-12-26',
  '1925-12-26',
  '1931-12-26',
  '1936-12-26',
  // ChristmasEvesAdhoc
  '1900-12-24',
  '1945-12-24',
  '1956-12-24',
  // DayAfterChristmasAdhoc
  '1958-12-26',
  // USVetransDayAdHoc
  '1921-11-11',
  '1968-11-11',
  // SatAfterColumbusDayAdHoc
  '1917-10-13',
  '1945-10-13',
  // LincolnsBirthDayAdhoc
  '1968-02-12',
  // GrantsBirthDayAdhoc
  '1897-04-27',
  // SatBeforeNewYearsAdhoc
  '1916-12-30',
  // SatBeforeWashingtonsBirthdayAdhoc
  '1903-02-21',
  // SatAfterWashingtonsBirthdayAdhoc
  '1901-02-23',
  '1907-02-23',
  '1929-02-23',
  '1946-02-23',
  // SatBeforeAfterLincolnsBirthdayAdhoc
  '1899-02-11',
  '1909-02-13',
  // SatBeforeDecorationAdhoc
  '1904-05-28',
  '1909-05-29',
  '1910-05-28',
  '1921-05-28',
  '1926-05-29',
  '1937-05-29',
  // SatAfterDecorationAdhoc
  '1902-05-31',
  '1913-05-31',
  '1919-05-31',
  '1924-05-31',
  '1930-05-31',
  // DayBeforeDecorationAdhoc
  '1899-05-29',
  '1961-05-29',
  // ── Irregular full-day closures ──
  // UlyssesGrantFuneral1885
  '1885-08-08',
  // ColumbianCelebration1892
  '1892-10-12',
  '1892-10-21',
  '1892-10-22',
  '1893-04-27',
  // GreatBlizzardOf1888
  '1888-03-12',
  '1888-03-13',
  // WashingtonInaugurationCentennialCelebration1889
  '1889-04-29',
  '1889-04-30',
  '1889-05-01',
  // CharterDay1898
  '1898-05-04',
  // WelcomeNavalCommander1898
  '1898-08-20',
  // AdmiralDeweyCelebration1899
  '1899-09-29',
  '1899-09-30',
  // GarretHobartFuneral1899
  '1899-11-25',
  // QueenVictoriaFuneral1901
  '1901-02-02',
  // MovedToProduceExchange1901
  '1901-04-27',
  // EnlargedProduceExchange1901
  '1901-05-11',
  // McKinleyDeathAndFuneral1901
  '1901-09-14',
  '1901-09-19',
  // KingEdwardVIIcoronation1902
  '1902-08-09',
  // NYSEnewBuildingOpen1903
  '1903-04-22',
  // HudsonFultonCelebration1909
  '1909-09-25',
  // JamesShermanFuneral1912
  '1912-11-02',
  // WeatherHeatClosing1917
  '1917-08-04',
  // DraftRegistrationDay1917
  '1917-06-05',
  // WeatherNoHeatClosing1918
  '1918-01-28',
  '1918-02-04',
  '1918-02-11',
  // DraftRegistrationDay1918
  '1918-09-12',
  // ArmisticeSigned1918
  '1918-11-11',
  // Homecoming27Division1919
  '1919-03-25',
  // ParadeOf77thDivision1919
  '1919-05-06',
  // BacklogRelief1919
  '1919-07-19',
  '1919-08-02',
  '1919-08-16',
  // GeneralPershingReturn1919
  '1919-09-10',
  // OfficeLocationChange1920
  '1920-05-01',
  // HardingDeath1923, HardingFuneral1923
  '1923-08-03',
  '1923-08-10',
  // LindberghParade1927
  '1927-06-13',
  // BacklogRelief1928
  '1928-04-07',
  '1928-04-21',
  '1928-05-05',
  '1928-05-12',
  '1928-05-19',
  '1928-05-26',
  '1928-11-24',
  // BacklogRelief1929
  '1929-02-09',
  '1929-11-01',
  '1929-11-02',
  '1929-11-09',
  '1929-11-16',
  '1929-11-23',
  '1929-11-29',
  '1929-11-30',
  // CoolidgeFuneral1933
  '1933-01-07',
  // BankHolidays1933 (Mar 4, 6-14)
  '1933-03-04',
  '1933-03-06',
  '1933-03-07',
  '1933-03-08',
  '1933-03-09',
  '1933-03-10',
  '1933-03-11',
  '1933-03-13',
  '1933-03-14',
  // (Mar 12, 1933 was a Sunday — naturally non-trading; upstream set still
  // includes it but our weekmask excludes Sundays. Keep parity by listing it.)
  '1933-03-12',
  // HeavyVolume1933 (closed Saturdays)
  '1933-07-29',
  '1933-08-05',
  '1933-08-12',
  '1933-08-19',
  '1933-08-26',
  '1933-09-02',
  // SatClosings1944
  '1944-08-19',
  '1944-08-26',
  '1944-09-02',
  // RooseveltDayOfMourning1945
  '1945-04-14',
  // VJday1945
  '1945-08-15',
  '1945-08-16',
  // NavyDay1945
  '1945-10-27',
  // RailroadStrike1946
  '1946-05-25',
  // SevereWeather1948
  '1948-01-03',
  // KennedyFuneral1963
  '1963-11-25',
  // MLKdayOfMourning1968
  '1968-04-09',
  // PaperworkCrisis1968 (every Wednesday from 1968-06-12 through 1968-12-18,
  // skipping holiday weeks per upstream literal list)
  '1968-06-12',
  '1968-06-19',
  '1968-06-26',
  '1968-07-10',
  '1968-07-17',
  '1968-07-24',
  '1968-07-31',
  '1968-08-07',
  '1968-08-14',
  '1968-08-21',
  '1968-08-28',
  '1968-09-11',
  '1968-09-18',
  '1968-09-25',
  '1968-10-02',
  '1968-10-09',
  '1968-10-16',
  '1968-10-23',
  '1968-10-30',
  '1968-11-20',
  '1968-12-04',
  '1968-12-11',
  '1968-12-18',
  // SnowClosing1969
  '1969-02-10',
  // EisenhowerFuneral1969
  '1969-03-31',
  // FirstLunarLandingClosing1969
  '1969-07-21',
  // TrumanFuneral1972
  '1972-12-28',
  // JohnsonFuneral1973
  '1973-01-25',
  // NewYorkCityBlackout77
  '1977-07-14',
  // HurricaneGloriaClosings1985
  '1985-09-27',
  // NixonFuneral1994
  '1994-04-27',
  // ReaganMourning2004
  '2004-06-11',
  // FordMourning2007
  '2007-01-02',
  // September11Closings2001
  '2001-09-11',
  '2001-09-12',
  '2001-09-13',
  '2001-09-14',
  // HurricaneSandyClosings2012
  '2012-10-29',
  '2012-10-30',
  // GeorgeHWBushDeath2018
  '2018-12-05',
  // JimmyCarterDeath2025
  '2025-01-09',
];

// Saturday-summer closings 1945-1952 (every Saturday in the listed window).
function* generateSummerSaturdays(): IterableIterator<string> {
  const ranges: ReadonlyArray<[string, string]> = [
    ['1945-07-07', '1945-09-01'],
    ['1946-06-01', '1946-09-28'],
    ['1947-05-31', '1947-09-27'],
    ['1948-05-29', '1948-09-25'],
    ['1949-05-28', '1949-09-24'],
    ['1950-06-03', '1950-09-30'],
    ['1951-06-02', '1951-09-29'],
    ['1952-05-31', '1952-09-27'],
  ];
  for (const [from, to] of ranges) {
    let d = new Date(`${from}T00:00:00.000Z`);
    const end = new Date(`${to}T00:00:00.000Z`);
    while (d.getTime() <= end.getTime()) {
      if (d.getUTCDay() === SAT) yield ymd(d);
      d = new Date(d.getTime() + MS_PER_DAY);
    }
  }
}

// WWI shutdown 1914-07-31 → 1914-12-11 (every Mon-Sat).
function* generateWWIShutdown(): IterableIterator<string> {
  let d = new Date('1914-07-31T00:00:00.000Z');
  const end = new Date('1914-12-11T00:00:00.000Z');
  while (d.getTime() <= end.getTime()) {
    const dow = d.getUTCDay();
    if (dow !== SUN) yield ymd(d);
    d = new Date(d.getTime() + MS_PER_DAY);
  }
}

const ADHOC_HOLIDAYS: ReadonlySet<string> = new Set<string>([
  ...ADHOC_RAW,
  ...generateSummerSaturdays(),
  ...generateWWIShutdown(),
]);

// ─── Rule-driven special closes (early-close rules) ─────────────────────────
const SPECIAL_CLOSES: ReadonlyArray<SpecialClose> = [
  // 1pm — Day-after-Thanksgiving 1993+, Christmas Eve weekday 1999+,
  // pre-Independence Day Mon/Tue/Thu (1995+), Wed before Independence Day (2013+),
  // Friday-after-Independence Day pre-2013 (1996-2012).
  {
    name: 'Day after Thanksgiving 1pm (1993+)',
    validFrom: 1993,
    closeAt: { h: 13, m: 0 },
    resolve: (y) => {
      const t = nthWeekdayOfMonth(y, 11, THU, 4);
      return new Date(t.getTime() + MS_PER_DAY);
    },
  },
  {
    name: 'Day after Thanksgiving 2pm (1992)',
    validFrom: 1992,
    validUntil: 1992,
    closeAt: { h: 14, m: 0 },
    resolve: (y) => {
      const t = nthWeekdayOfMonth(y, 11, THU, 4);
      return new Date(t.getTime() + MS_PER_DAY);
    },
  },
  {
    name: 'Christmas Eve Mon-Thu 1pm (1999+)',
    validFrom: 1999,
    closeAt: { h: 13, m: 0 },
    resolve: (y) => {
      const d = utcDate(y, 12, 24);
      const dow = d.getUTCDay();
      return dow >= MON && dow <= THU ? d : null;
    },
  },
  {
    name: 'Mon/Tue/Thu before Independence Day 1pm (1995+)',
    validFrom: 1995,
    closeAt: { h: 13, m: 0 },
    resolve: (y) => {
      const d = utcDate(y, 7, 3);
      const dow = d.getUTCDay();
      return dow === MON || dow === TUE || dow === THU ? d : null;
    },
  },
  {
    name: 'Wed before Independence Day 1pm (2013+)',
    validFrom: 2013,
    closeAt: { h: 13, m: 0 },
    resolve: (y) => {
      const d = utcDate(y, 7, 3);
      return d.getUTCDay() === WED ? d : null;
    },
  },
  {
    name: 'Friday after Independence Day 1pm (1996-2012)',
    validFrom: 1996,
    validUntil: 2012,
    closeAt: { h: 13, m: 0 },
    resolve: (y) => {
      const d = utcDate(y, 7, 5);
      return d.getUTCDay() === FRI ? d : null;
    },
  },
];

// ─── Adhoc special closes (literal map) ─────────────────────────────────────
const SPECIAL_CLOSES_ADHOC: AdhocTimeOverrides = new Map<string, TimeOfDay>([
  // 1pm closes
  ['1908-06-26', { h: 13, m: 0 }], // Grover Cleveland funeral
  // ChristmasEve1pmEarlyCloseAdhoc
  ['1951-12-24', { h: 13, m: 0 }],
  ['1996-12-24', { h: 13, m: 0 }],
  ['1997-12-24', { h: 13, m: 0 }],
  ['1998-12-24', { h: 13, m: 0 }],
  ['1999-12-24', { h: 13, m: 0 }],
  // DayAfterChristmas1pmEarlyCloseAdhoc
  ['1997-12-26', { h: 13, m: 0 }],
  ['2003-12-26', { h: 13, m: 0 }],
  // BacklogRelief1pmEarlyClose1929
  ['1929-11-06', { h: 13, m: 0 }],
  ['1929-11-07', { h: 13, m: 0 }],
  ['1929-11-08', { h: 13, m: 0 }],
  ['1929-11-11', { h: 13, m: 0 }],
  ['1929-11-12', { h: 13, m: 0 }],
  ['1929-11-13', { h: 13, m: 0 }],
  ['1929-11-14', { h: 13, m: 0 }],
  ['1929-11-15', { h: 13, m: 0 }],
  ['1929-11-18', { h: 13, m: 0 }],
  ['1929-11-19', { h: 13, m: 0 }],
  ['1929-11-20', { h: 13, m: 0 }],
  ['1929-11-21', { h: 13, m: 0 }],
  ['1929-11-22', { h: 13, m: 0 }],
  // 12pm early close — ParadeOfNationalGuard1917
  ['1917-08-29', { h: 12, m: 0 }],
  // LibertyDay 1917
  ['1917-10-24', { h: 12, m: 0 }],
  // LibertyDay 1918
  ['1918-04-26', { h: 12, m: 0 }],
  // WallStreetExplosion 1920
  ['1920-09-16', { h: 12, m: 0 }],
  // NRAdemonstration 1933
  ['1933-09-13', { h: 12, m: 0 }],
  // 12:30pm — RooseveltFuneral 1919
  ['1919-01-07', { h: 12, m: 30 }],
  // WoodrowWilsonFuneral 1924
  ['1924-02-06', { h: 12, m: 30 }],
  // TaftFuneral 1930
  ['1930-03-11', { h: 12, m: 30 }],
  // GasFumes 1933
  ['1933-08-04', { h: 12, m: 30 }],
  // 11am close — KingEdwardDeath 1910
  ['1910-05-07', { h: 11, m: 0 }],
  // 14:00 — HooverFuneral 1964
  ['1964-10-23', { h: 14, m: 0 }],
  // Snow2pmEarlyClose1967 (Feb 7, 1967)
  ['1967-02-07', { h: 14, m: 0 }],
  // Snow2pmEarlyClose1978
  ['1978-02-06', { h: 14, m: 0 }],
  // Snow2pmEarlyClose1996
  ['1996-01-08', { h: 14, m: 0 }],
  // 14:07 — Kennedy assassination
  ['1963-11-22', { h: 14, m: 7 }],
  // 14:30 — FalseArmistice 1918
  ['1918-11-07', { h: 14, m: 30 }],
  // CromwellFuneral 1925
  ['1925-09-18', { h: 14, m: 30 }],
  // Snow230EarlyClose1975
  ['1975-02-12', { h: 14, m: 30 }],
  // Snow230pmEarlyClose1994
  ['1994-02-11', { h: 14, m: 30 }],
  // 15:00 — HurricaneWatch 1976
  ['1976-08-09', { h: 15, m: 0 }],
  // 15:17 — Reagan assassination attempt
  ['1981-03-30', { h: 15, m: 17 }],
  // 15:28 — ConEd power fail
  ['1981-09-09', { h: 15, m: 28 }],
  // 15:30 — CircuitBreakerTriggered 1997
  ['1997-10-27', { h: 15, m: 30 }],
  // 15:56 — SystemProb 2005
  ['2005-06-01', { h: 15, m: 56 }],
  // ChristmasEve2pmEarlyCloseAdhoc
  ['1974-12-24', { h: 14, m: 0 }],
  ['1975-12-24', { h: 14, m: 0 }],
  ['1990-12-24', { h: 14, m: 0 }],
  ['1991-12-24', { h: 14, m: 0 }],
  ['1992-12-24', { h: 14, m: 0 }],
  // HeavyVolume2pmEarlyClose1933
  ['1933-07-26', { h: 14, m: 0 }],
  ['1933-07-27', { h: 14, m: 0 }],
  ['1933-07-28', { h: 14, m: 0 }],
  // BacklogRelief2pmEarlyClose1928 (May 21-25, 1928 Mon-Fri+Sat)
  ['1928-05-21', { h: 14, m: 0 }],
  ['1928-05-22', { h: 14, m: 0 }],
  ['1928-05-23', { h: 14, m: 0 }],
  ['1928-05-24', { h: 14, m: 0 }],
  ['1928-05-25', { h: 14, m: 0 }],
  // 1987 backlog 2pm: Oct 23-30 (Fri-Fri); Mon-Fri set
  ['1987-10-23', { h: 14, m: 0 }],
  ['1987-10-26', { h: 14, m: 0 }],
  ['1987-10-27', { h: 14, m: 0 }],
  ['1987-10-28', { h: 14, m: 0 }],
  ['1987-10-29', { h: 14, m: 0 }],
  ['1987-10-30', { h: 14, m: 0 }],
  // 1987 backlog 2:30pm: Nov 2-4
  ['1987-11-02', { h: 14, m: 30 }],
  ['1987-11-03', { h: 14, m: 30 }],
  ['1987-11-04', { h: 14, m: 30 }],
  // 1987 backlog 3pm: Nov 5-6
  ['1987-11-05', { h: 15, m: 0 }],
  ['1987-11-06', { h: 15, m: 0 }],
  // 1987 backlog 3:30pm: Nov 9-11
  ['1987-11-09', { h: 15, m: 30 }],
  ['1987-11-10', { h: 15, m: 30 }],
  ['1987-11-11', { h: 15, m: 30 }],
]);

// 1966 transit strike 2pm closes (Jan 6-14 weekdays).
(() => {
  let d = new Date('1966-01-06T00:00:00.000Z');
  const end = new Date('1966-01-14T00:00:00.000Z');
  while (d.getTime() <= end.getTime()) {
    const dow = d.getUTCDay();
    if (dow >= MON && dow <= FRI) {
      (SPECIAL_CLOSES_ADHOC as Map<string, TimeOfDay>).set(ymd(d), { h: 14, m: 0 });
    }
    d = new Date(d.getTime() + MS_PER_DAY);
  }
})();

// 1967 backlog 2pm closes (Aug 9-18 weekdays).
(() => {
  let d = new Date('1967-08-09T00:00:00.000Z');
  const end = new Date('1967-08-18T00:00:00.000Z');
  while (d.getTime() <= end.getTime()) {
    const dow = d.getUTCDay();
    if (dow >= MON && dow <= FRI) {
      (SPECIAL_CLOSES_ADHOC as Map<string, TimeOfDay>).set(ymd(d), { h: 14, m: 0 });
    }
    d = new Date(d.getTime() + MS_PER_DAY);
  }
})();

// 1968 backlog 2pm closes (Jan 22 - Mar 1 weekdays).
(() => {
  let d = new Date('1968-01-22T00:00:00.000Z');
  const end = new Date('1968-03-01T00:00:00.000Z');
  while (d.getTime() <= end.getTime()) {
    const dow = d.getUTCDay();
    if (dow >= MON && dow <= FRI) {
      (SPECIAL_CLOSES_ADHOC as Map<string, TimeOfDay>).set(ymd(d), { h: 14, m: 0 });
    }
    d = new Date(d.getTime() + MS_PER_DAY);
  }
})();

// 1969 paperwork crisis 2pm (Jan 1 - Jul 3 weekdays).
(() => {
  let d = new Date('1969-01-01T00:00:00.000Z');
  const end = new Date('1969-07-03T00:00:00.000Z');
  while (d.getTime() <= end.getTime()) {
    const dow = d.getUTCDay();
    if (dow >= MON && dow <= FRI) {
      (SPECIAL_CLOSES_ADHOC as Map<string, TimeOfDay>).set(ymd(d), { h: 14, m: 0 });
    }
    d = new Date(d.getTime() + MS_PER_DAY);
  }
})();

// 1969 paperwork crisis 2:30pm (Jul 7 - Sep 26 weekdays).
(() => {
  let d = new Date('1969-07-07T00:00:00.000Z');
  const end = new Date('1969-09-26T00:00:00.000Z');
  while (d.getTime() <= end.getTime()) {
    const dow = d.getUTCDay();
    if (dow >= MON && dow <= FRI) {
      (SPECIAL_CLOSES_ADHOC as Map<string, TimeOfDay>).set(ymd(d), { h: 14, m: 30 });
    }
    d = new Date(d.getTime() + MS_PER_DAY);
  }
})();

// 1969-1970 paperwork crisis 3pm (Sep 29, 1969 - May 1, 1970 weekdays).
(() => {
  let d = new Date('1969-09-29T00:00:00.000Z');
  const end = new Date('1970-05-01T00:00:00.000Z');
  while (d.getTime() <= end.getTime()) {
    const dow = d.getUTCDay();
    if (dow >= MON && dow <= FRI) {
      (SPECIAL_CLOSES_ADHOC as Map<string, TimeOfDay>).set(ymd(d), { h: 15, m: 0 });
    }
    d = new Date(d.getTime() + MS_PER_DAY);
  }
})();

// ─── Rule-driven special opens ──────────────────────────────────────────────
const SPECIAL_OPENS: ReadonlyArray<SpecialOpen> = [];

// ─── Adhoc special opens (literal map) ──────────────────────────────────────
const SPECIAL_OPENS_ADHOC: AdhocTimeOverrides = new Map<string, TimeOfDay>([
  // 9:31am — ConEdXformer1990
  ['1990-12-27', { h: 9, m: 31 }],
  // EnduringFreedomMomentSilence 2001
  ['2001-10-08', { h: 9, m: 31 }],
  // 9:32am — IraqiFreedom 2003
  ['2003-03-20', { h: 9, m: 32 }],
  // ReaganMomentSilence 2004
  ['2004-06-07', { h: 9, m: 32 }],
  // FordMomentSilence 2006
  ['2006-12-27', { h: 9, m: 32 }],
  // 9:33am — Sept11MomentSilence 2001
  ['2001-09-17', { h: 9, m: 33 }],
  // 10:15 — Snow1015LateOpen1967
  ['1967-02-07', { h: 10, m: 15 }],
  // MerrillLynchComputer1015LateOpen1974
  ['1974-01-16', { h: 10, m: 15 }],
  // FireDrill1015LateOpen1974
  ['1974-11-22', { h: 10, m: 15 }],
  // FireDrill1015LateOpen1976
  ['1976-06-08', { h: 10, m: 15 }],
  // 10:30 — TrafficBlockLateOpen1919
  ['1919-12-30', { h: 10, m: 30 }],
  // TrafficBlockLateOpen1920
  ['1920-02-06', { h: 10, m: 30 }],
  // Computer1030LateOpen1995
  ['1995-12-18', { h: 10, m: 30 }],
  // 10:45 — EclipseOfSunLateOpen1925
  ['1925-01-24', { h: 10, m: 45 }],
  // Storm1045LateOpen1969
  ['1969-06-02', { h: 10, m: 45 }],
  // 11:00 — Snow11amLateOpen1934
  ['1934-02-20', { h: 11, m: 0 }],
  // KingGeorgeVFuneral1936
  ['1936-01-28', { h: 11, m: 0 }],
  // Snow11amLateOpening1960
  ['1960-12-12', { h: 11, m: 0 }],
  // Snow11amLateOpen1969
  ['1969-02-11', { h: 11, m: 0 }],
  // Ice11amLateOpen1973
  ['1973-12-17', { h: 11, m: 0 }],
  // Snow11amLateOpen1978
  ['1978-02-07', { h: 11, m: 0 }],
  // Fire11amLateOpen1989
  ['1989-11-10', { h: 11, m: 0 }],
  // Snow11amLateOpen1996
  ['1996-01-08', { h: 11, m: 0 }],
  // 11:05 — PowerFail1965
  ['1965-11-10', { h: 11, m: 5 }],
  // 11:15 — Storm1115LateOpen1976
  ['1976-02-02', { h: 11, m: 15 }],
  // 12:00 — KingEdwardFuneral1910
  ['1910-05-20', { h: 12, m: 0 }],
  // JPMorganFuneral1913
  ['1913-04-14', { h: 12, m: 0 }],
  // WilliamGaynorFuneral1913
  ['1913-09-22', { h: 12, m: 0 }],
  // Snow12pmLateOpen1978
  ['1978-01-20', { h: 12, m: 0 }],
  // Sept11Anniversary 2002
  ['2002-09-11', { h: 12, m: 0 }],
  // BacklogRelief12pmLateOpen1929
  ['1929-10-31', { h: 12, m: 0 }],
  // HeavyVolume12pmLateOpen1933
  ['1933-07-24', { h: 12, m: 0 }],
  ['1933-07-25', { h: 12, m: 0 }],
  // HeavyVolume11amLateOpen1933
  ['1933-07-26', { h: 11, m: 0 }],
  ['1933-07-27', { h: 11, m: 0 }],
  ['1933-07-28', { h: 11, m: 0 }],
  // 13:00 — AnnunciatorBoardFire 1921
  ['1921-08-02', { h: 13, m: 0 }],
  // TroopsInGulf931LateOpens1991
  ['1991-01-17', { h: 9, m: 31 }],
  ['1991-02-25', { h: 9, m: 31 }],
]);

/**
 * NYSE / NYSE-equivalent (NASDAQ, BATS, DJIA, DOW) trading-day calendar from
 * 1885-01-01 onward. Faithful port of pandas_market_calendars' nyse.py.
 *
 * Era-varying session times:
 *   - open: 10:00 (pre-1985-09-30) → 09:30 (1985-09-30+)
 *   - close: 15:00 (pre-1952-09-29) → 15:30 (1952-09-29 → 1973-12-31) → 16:00 (1974-01-02+)
 *   - Saturday (when active, pre-1952-09-29): 12:00 close (approximation)
 *
 * Variable weekmask: Mon-Sat through 1952-09-28; Mon-Fri from 1952-09-29 on.
 */
export class NYSEExchangeCalendar extends ExchangeCalendar {
  readonly name = 'NYSE';
  readonly tz = 'America/New_York';

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

  protected override regularOpen(date: Date): TimeOfDay {
    return ymd(date) < '1985-09-30' ? { h: 10, m: 0 } : { h: 9, m: 30 };
  }

  protected override regularClose(date: Date): TimeOfDay {
    const key = ymd(date);
    // Saturday close pre-1952 was 12:00 (approximation, see spec).
    if (key < SATURDAY_END_KEY && date.getUTCDay() === SAT) return { h: 12, m: 0 };
    if (key < SATURDAY_END_KEY) return { h: 15, m: 0 };
    if (key < '1974-01-02') return { h: 15, m: 30 };
    return { h: 16, m: 0 };
  }

  protected override weekmask(date: Date): ReadonlySet<number> {
    return ymd(date) < SATURDAY_END_KEY ? WEEKDAYS_MON_SAT : WEEKDAYS_MON_FRI;
  }
}
