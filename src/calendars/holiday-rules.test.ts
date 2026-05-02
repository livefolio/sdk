import { describe, it, expect } from 'vitest';
import {
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  easter,
  observed,
  resolveHolidays,
  type HolidayRule,
} from './holiday-rules';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('nthWeekdayOfMonth', () => {
  it('returns 3rd Monday of January 2024 (MLK Day)', () => {
    expect(nthWeekdayOfMonth(2024, 1, 1, 3).toISOString()).toBe(utc('2024-01-15').toISOString());
  });
  it('returns 4th Thursday of November 2024 (Thanksgiving)', () => {
    expect(nthWeekdayOfMonth(2024, 11, 4, 4).toISOString()).toBe(utc('2024-11-28').toISOString());
  });
});

describe('lastWeekdayOfMonth', () => {
  it('returns last Monday of May 2024 (Memorial Day)', () => {
    expect(lastWeekdayOfMonth(2024, 5, 1).toISOString()).toBe(utc('2024-05-27').toISOString());
  });
  it('returns last Monday of August 2024 (UK Summer Bank Holiday)', () => {
    expect(lastWeekdayOfMonth(2024, 8, 1).toISOString()).toBe(utc('2024-08-26').toISOString());
  });
});

describe('easter', () => {
  it('returns Easter Sunday 2024 (March 31)', () => {
    expect(easter(2024).toISOString()).toBe(utc('2024-03-31').toISOString());
  });
  it('returns Easter Sunday 2025 (April 20)', () => {
    expect(easter(2025).toISOString()).toBe(utc('2025-04-20').toISOString());
  });
});

describe('observed', () => {
  it('shifts Saturday → Friday', () => {
    expect(observed(utc('2022-01-01')).toISOString()).toBe(utc('2021-12-31').toISOString());
  });
  it('shifts Sunday → Monday', () => {
    expect(observed(utc('2023-01-01')).toISOString()).toBe(utc('2023-01-02').toISOString());
  });
  it('leaves weekdays unchanged', () => {
    expect(observed(utc('2024-01-01')).toISOString()).toBe(utc('2024-01-01').toISOString());
  });
});

describe('resolveHolidays', () => {
  const juneteenth: HolidayRule = {
    name: 'Juneteenth',
    resolve: (y) => new Date(Date.UTC(y, 5, 19)),
    validFrom: 2022,
    observe: true,
  };

  it('returns empty set when year is before validFrom', () => {
    const set = resolveHolidays([juneteenth], 2020);
    expect(set.size).toBe(0);
  });

  it('includes the rule when year >= validFrom', () => {
    const set = resolveHolidays([juneteenth], 2022); // June 19 2022 = Sunday → observed Monday June 20
    expect(set.has(utc('2022-06-20').getTime())).toBe(true);
  });

  it('honors validUntil', () => {
    const rule: HolidayRule = {
      name: 'X',
      resolve: (y) => new Date(Date.UTC(y, 0, 15)),
      validUntil: 2010,
    };
    expect(resolveHolidays([rule], 2011).size).toBe(0);
    expect(resolveHolidays([rule], 2010).size).toBe(1);
  });
});

describe('resolveSessionTime', () => {
  it('returns the unbounded default when no era rule applies yet', async () => {
    const { resolveSessionTime } = await import('./holiday-rules');
    const time = resolveSessionTime(
      [{ time: { h: 10, m: 0 } }, { effectiveFrom: '1985-09-30', time: { h: 9, m: 30 } }],
      utc('1980-01-01'),
    );
    expect(time).toEqual({ h: 10, m: 0 });
  });
  it('picks the latest rule whose effectiveFrom ≤ date', async () => {
    const { resolveSessionTime } = await import('./holiday-rules');
    const rules = [
      { time: { h: 15, m: 0 } },
      { effectiveFrom: '1952-09-29', time: { h: 15, m: 30 } },
      { effectiveFrom: '1974-01-02', time: { h: 16, m: 0 } },
    ];
    expect(resolveSessionTime(rules, utc('1951-06-01'))).toEqual({ h: 15, m: 0 });
    expect(resolveSessionTime(rules, utc('1952-09-29'))).toEqual({ h: 15, m: 30 });
    expect(resolveSessionTime(rules, utc('1973-12-31'))).toEqual({ h: 15, m: 30 });
    expect(resolveSessionTime(rules, utc('1974-01-02'))).toEqual({ h: 16, m: 0 });
    expect(resolveSessionTime(rules, utc('2024-06-03'))).toEqual({ h: 16, m: 0 });
  });
});

describe('resolveSpecialOpens / resolveSpecialCloses', () => {
  it('SpecialOpen: returns Map<dayMs, TimeOfDay>', async () => {
    const { resolveSpecialOpens } = await import('./holiday-rules');
    const rules = [
      { name: 'Late open', resolve: (y: number) => new Date(Date.UTC(y, 0, 15)), openAt: { h: 11, m: 0 } },
    ];
    const map = resolveSpecialOpens(rules, 2024);
    expect(map.get(utc('2024-01-15').getTime())).toEqual({ h: 11, m: 0 });
  });

  it('SpecialClose: returns Map<dayMs, TimeOfDay>', async () => {
    const { resolveSpecialCloses } = await import('./holiday-rules');
    const rules = [
      { name: 'Early close', resolve: (y: number) => new Date(Date.UTC(y, 6, 3)), closeAt: { h: 13, m: 0 } },
    ];
    const map = resolveSpecialCloses(rules, 2024);
    expect(map.get(utc('2024-07-03').getTime())).toEqual({ h: 13, m: 0 });
  });

  it('SpecialClose: honors validFrom/validUntil', async () => {
    const { resolveSpecialCloses } = await import('./holiday-rules');
    const rules = [
      {
        name: 'Bounded',
        resolve: (y: number) => new Date(Date.UTC(y, 0, 15)),
        closeAt: { h: 13, m: 0 },
        validFrom: 2020,
        validUntil: 2022,
      },
    ];
    expect(resolveSpecialCloses(rules, 2019).size).toBe(0);
    expect(resolveSpecialCloses(rules, 2020).size).toBe(1);
    expect(resolveSpecialCloses(rules, 2022).size).toBe(1);
    expect(resolveSpecialCloses(rules, 2023).size).toBe(0);
  });
});
