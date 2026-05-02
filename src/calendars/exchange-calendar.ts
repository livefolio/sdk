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

export abstract class ExchangeCalendar implements Calendar {
  abstract readonly name: string;
  abstract readonly tz: string;

  private readonly holidayCache = new Map<number, Set<number>>();
  private readonly specialCloseCache = new Map<number, Map<number, TimeOfDay>>();
  private readonly specialOpenCache = new Map<number, Map<number, TimeOfDay>>();

  // --- Hooks ---
  protected regularHolidays(): ReadonlyArray<HolidayRule> {
    return [];
  }
  protected adhocHolidays(): ReadonlySet<string> {
    return new Set();
  }
  protected specialCloses(): ReadonlyArray<SpecialClose> {
    return [];
  }
  protected specialClosesAdhoc(): AdhocTimeOverrides {
    return EMPTY_ADHOC;
  }
  protected specialOpens(): ReadonlyArray<SpecialOpen> {
    return [];
  }
  protected specialOpensAdhoc(): AdhocTimeOverrides {
    return EMPTY_ADHOC;
  }
  protected regularOpen(_date: Date): TimeOfDay {
    return { h: 9, m: 30 };
  }
  protected regularClose(_date: Date): TimeOfDay {
    return { h: 16, m: 0 };
  }
  protected weekmask(_date: Date): ReadonlySet<number> {
    return DEFAULT_WEEKMASK;
  }

  // --- Caches ---
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
  isOpen(t: Date): boolean {
    const d = this.normalize(t);
    if (!this.weekmask(d).has(d.getUTCDay())) return false;
    if (this.adhocHolidays().has(ymdKey(d))) return false;
    const year = d.getUTCFullYear();
    if (this.holidaysForYear(year).has(d.getTime())) return false;
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
    if (this.specialClosesAdhoc().has(ymdKey(d))) return true;
    return this.specialClosesForYear(d.getUTCFullYear()).has(d.getTime());
  }

  // --- Resolution ---
  /** Adhoc overrides win over rule-driven; both win over `regularOpen(date)`. */
  private openTimeFor(date: Date): TimeOfDay {
    const adhoc = this.specialOpensAdhoc().get(ymdKey(date));
    if (adhoc) return adhoc;
    const ruled = this.specialOpensForYear(date.getUTCFullYear()).get(date.getTime());
    if (ruled) return ruled;
    return this.regularOpen(date);
  }

  private closeTimeFor(date: Date): TimeOfDay {
    const adhoc = this.specialClosesAdhoc().get(ymdKey(date));
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
