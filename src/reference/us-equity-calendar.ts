import type { Calendar } from '../interfaces/calendar';
import type { DateRange } from '../interfaces/types';

const MS_PER_DAY = 86_400_000;

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function dayOfWeek(d: Date): number {
  return d.getUTCDay();
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = utcDate(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return utcDate(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(last.getTime() - offset * MS_PER_DAY);
}

function easter(year: number): Date {
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
  return utcDate(year, month, day);
}

function observed(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return new Date(d.getTime() - MS_PER_DAY);
  if (dow === 0) return new Date(d.getTime() + MS_PER_DAY);
  return d;
}

function holidaysForYear(year: number): Set<number> {
  const set = new Set<number>();
  const add = (d: Date) => set.add(d.getTime());
  add(observed(utcDate(year, 1, 1)));
  add(nthWeekdayOfMonth(year, 1, 1, 3));
  add(nthWeekdayOfMonth(year, 2, 1, 3));
  add(new Date(easter(year).getTime() - 2 * MS_PER_DAY));
  add(lastWeekdayOfMonth(year, 5, 1));
  add(observed(utcDate(year, 6, 19)));
  add(observed(utcDate(year, 7, 4)));
  add(nthWeekdayOfMonth(year, 9, 1, 1));
  add(nthWeekdayOfMonth(year, 11, 4, 4));
  add(observed(utcDate(year, 12, 25)));
  return set;
}

export class USEquityCalendar implements Calendar {
  private cache = new Map<number, Set<number>>();

  private holidays(year: number): Set<number> {
    let set = this.cache.get(year);
    if (!set) {
      set = holidaysForYear(year);
      this.cache.set(year, set);
    }
    return set;
  }

  private normalize(t: Date): Date {
    return utcDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  isOpen(t: Date): boolean {
    const d = this.normalize(t);
    const dow = dayOfWeek(d);
    if (dow === 0 || dow === 6) return false;
    const year = d.getUTCFullYear();
    // Dec 31 can be the observed NYD for the following year (when Jan 1 falls on Saturday)
    // so also check next year's holiday set when the date is Dec 31.
    const ts = d.getTime();
    if (this.holidays(year).has(ts)) return false;
    if (d.getUTCMonth() === 11 && d.getUTCDate() === 31 && this.holidays(year + 1).has(ts)) return false;
    return true;
  }

  next(t: Date): Date {
    let d = new Date(this.normalize(t).getTime() + MS_PER_DAY);
    while (!this.isOpen(d)) d = new Date(d.getTime() + MS_PER_DAY);
    return d;
  }

  previous(t: Date): Date {
    let d = new Date(this.normalize(t).getTime() - MS_PER_DAY);
    while (!this.isOpen(d)) d = new Date(d.getTime() - MS_PER_DAY);
    return d;
  }

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

  schedule(_range: DateRange): ReadonlyArray<import('../interfaces/calendar').Session> {
    throw new Error('USEquityCalendar.schedule() not implemented — use NYSEExchangeCalendar from src/calendars');
  }

  isEarlyClose(_t: Date): boolean {
    throw new Error('USEquityCalendar.isEarlyClose() not implemented — use NYSEExchangeCalendar from src/calendars');
  }
}
