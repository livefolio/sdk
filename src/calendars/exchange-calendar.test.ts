import { describe, it, expect } from 'vitest';
import { ExchangeCalendar } from './exchange-calendar';
import type { HolidayRule, SpecialClose, SpecialOpen, AdhocTimeOverrides } from './holiday-rules';
import type { TimeOfDay } from '../interfaces/calendar';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const SAT_CUTOFF = '1952-09-29'; // Mon–Sat → Mon–Fri at this date

class TestCalendar extends ExchangeCalendar {
  readonly name = 'TEST';
  readonly tz = 'America/New_York';
  protected regularHolidays(): ReadonlyArray<HolidayRule> {
    return [
      { name: 'NYD', resolve: (y) => new Date(Date.UTC(y, 0, 1)), observe: true },
      { name: 'Christmas', resolve: (y) => new Date(Date.UTC(y, 11, 25)), observe: true },
    ];
  }
  protected adhocHolidays(): ReadonlySet<string> {
    return new Set(['2024-07-15', '1888-03-12']); // modern + historical adhoc
  }
  protected specialCloses(): ReadonlyArray<SpecialClose> {
    return [{ name: 'EarlyTest', resolve: (y) => new Date(Date.UTC(y, 6, 3)), closeAt: { h: 13, m: 0 } }];
  }
  protected specialClosesAdhoc(): AdhocTimeOverrides {
    return new Map([['2024-07-03', { h: 12, m: 0 }]]); // adhoc wins over rule-driven 13:00
  }
  protected specialOpens(): ReadonlyArray<SpecialOpen> {
    return [{ name: 'LateOpenTest', resolve: (y) => new Date(Date.UTC(y, 0, 8)), openAt: { h: 11, m: 0 } }];
  }
  protected specialOpensAdhoc(): AdhocTimeOverrides {
    return new Map([['1933-03-15', { h: 12, m: 0 }]]); // bank-holiday-style late open
  }
  // Era-varying close: 15:00 → 15:30 (1952-09-29) → 16:00 (1974-01-02)
  protected override regularClose(date: Date): TimeOfDay {
    const key = date.toISOString().slice(0, 10);
    if (key < '1952-09-29') return { h: 15, m: 0 };
    if (key < '1974-01-02') return { h: 15, m: 30 };
    return { h: 16, m: 0 };
  }
  protected override regularOpen(): TimeOfDay {
    return { h: 9, m: 30 };
  }
  // Mon–Sat through 1952-09-29; Mon–Fri from then on.
  protected override weekmask(date: Date): ReadonlySet<number> {
    const key = date.toISOString().slice(0, 10);
    return key < SAT_CUTOFF ? new Set([1, 2, 3, 4, 5, 6]) : new Set([1, 2, 3, 4, 5]);
  }
}

const cal = new TestCalendar();

describe('ExchangeCalendar (via TestCalendar)', () => {
  it('marks Monday open', () => expect(cal.isOpen(utc('2024-01-08'))).toBe(true));
  it('marks modern Saturday closed (post-cutoff)', () => expect(cal.isOpen(utc('2024-01-06'))).toBe(false));
  it('marks modern Sunday closed', () => expect(cal.isOpen(utc('2024-01-07'))).toBe(false));
  it('marks pre-cutoff Saturday open', () => expect(cal.isOpen(utc('1950-06-10'))).toBe(true));
  it('marks pre-cutoff Sunday closed (Sunday never open)', () => expect(cal.isOpen(utc('1950-06-11'))).toBe(false));
  it('marks post-cutoff Saturday closed (1953-06-13)', () => expect(cal.isOpen(utc('1953-06-13'))).toBe(false));
  it('marks Christmas closed', () => expect(cal.isOpen(utc('2024-12-25'))).toBe(false));
  it('marks Sunday-Christmas observed Monday closed (2022-12-26)', () => {
    expect(cal.isOpen(utc('2022-12-26'))).toBe(false);
  });
  it('marks modern adhoc closure closed', () => expect(cal.isOpen(utc('2024-07-15'))).toBe(false));
  it('marks historical adhoc closure closed (1888 blizzard)', () => {
    expect(cal.isOpen(utc('1888-03-12'))).toBe(false);
  });

  it('next() skips weekends in modern era', () => {
    expect(cal.next(utc('2024-01-05')).toISOString()).toBe(utc('2024-01-08').toISOString());
  });
  it('previous() skips weekends in modern era', () => {
    expect(cal.previous(utc('2024-01-08')).toISOString()).toBe(utc('2024-01-05').toISOString());
  });

  it('schedule() uses era-varying close: 1950 → 15:00 ET (= 19:00 UTC, EST since pre-DST-mod)', () => {
    // 1950-06-12 (Mon) — era 1: close 15:00 ET. June = EDT (UTC-4) = 19:00 UTC.
    const sched = cal.schedule({ from: utc('1950-06-12'), to: utc('1950-06-13') });
    expect(sched[0]!.close.toISOString()).toBe('1950-06-12T19:00:00.000Z');
  });
  it('schedule() uses era-varying close: 1973 → 15:30 ET', () => {
    // 1973-06-12 (Tue) EDT → 19:30 UTC
    const sched = cal.schedule({ from: utc('1973-06-12'), to: utc('1973-06-13') });
    expect(sched[0]!.close.toISOString()).toBe('1973-06-12T19:30:00.000Z');
  });
  it('schedule() uses era-varying close: modern → 16:00 ET (20:00 UTC EDT)', () => {
    const sched = cal.schedule({ from: utc('2024-06-03'), to: utc('2024-06-04') });
    expect(sched[0]!.open.toISOString()).toBe('2024-06-03T13:30:00.000Z');
    expect(sched[0]!.close.toISOString()).toBe('2024-06-03T20:00:00.000Z');
  });

  it('schedule() applies rule-driven special close (13:00 ET → 17:00 UTC EDT)', () => {
    // Use 2023 to avoid 2024-07-03 colliding with the adhoc override below
    const sched = cal.schedule({ from: utc('2023-07-03'), to: utc('2023-07-04') });
    expect(sched[0]!.close.toISOString()).toBe('2023-07-03T17:00:00.000Z');
  });
  it('schedule() applies adhoc-wins-over-rule (12:00 ET overrides 13:00 ET on 2024-07-03 → 16:00 UTC EDT)', () => {
    const sched = cal.schedule({ from: utc('2024-07-03'), to: utc('2024-07-04') });
    expect(sched[0]!.close.toISOString()).toBe('2024-07-03T16:00:00.000Z');
  });
  it('schedule() applies rule-driven special open (11:00 ET → 16:00 UTC EST in January)', () => {
    // Use 2024 - first 2024-01-08 is Monday; 11:00 ET in January = EST (UTC-5) = 16:00 UTC
    const sched = cal.schedule({ from: utc('2024-01-08'), to: utc('2024-01-09') });
    expect(sched[0]!.open.toISOString()).toBe('2024-01-08T16:00:00.000Z');
  });
  it('schedule() applies adhoc special open (1933-03-15 12:00 ET = 17:00 UTC EST → late open)', () => {
    // 1933-03-15 = Wednesday
    const sched = cal.schedule({ from: utc('1933-03-15'), to: utc('1933-03-16') });
    expect(sched[0]!.open.toISOString()).toBe('1933-03-15T17:00:00.000Z');
  });

  it('isEarlyClose() true for rule-driven special close', () => {
    expect(cal.isEarlyClose(utc('2023-07-03'))).toBe(true);
  });
  it('isEarlyClose() true for adhoc special close', () => {
    expect(cal.isEarlyClose(utc('2024-07-03'))).toBe(true);
  });
  it('isEarlyClose() false for a regular trading day', () => {
    expect(cal.isEarlyClose(utc('2024-07-08'))).toBe(false);
  });
});
