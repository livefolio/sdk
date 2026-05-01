import { describe, it, expect } from 'vitest';
import { USEquityCalendar } from './us-equity-calendar';

const cal = new USEquityCalendar();
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

describe('USEquityCalendar', () => {
  it('marks weekdays open', () => {
    expect(cal.isOpen(utc('2026-01-05'))).toBe(true);
    expect(cal.isOpen(utc('2026-01-06'))).toBe(true);
  });

  it('marks weekends closed', () => {
    expect(cal.isOpen(utc('2026-01-03'))).toBe(false);
    expect(cal.isOpen(utc('2026-01-04'))).toBe(false);
  });

  it('excludes New Years Day (observed Friday when Jan 1 is a Saturday)', () => {
    expect(cal.isOpen(utc('2021-12-31'))).toBe(false);
    expect(cal.isOpen(utc('2026-01-01'))).toBe(false);
  });

  it('excludes Christmas', () => {
    expect(cal.isOpen(utc('2026-12-25'))).toBe(false);
  });

  it('next(t) returns the next session', () => {
    expect(cal.next(utc('2026-01-02')).toISOString()).toBe(utc('2026-01-05').toISOString());
  });

  it('previous(t) returns the previous session', () => {
    expect(cal.previous(utc('2026-01-05')).toISOString()).toBe(utc('2026-01-02').toISOString());
  });

  it('sessions returns 5 days for a holiday-free week', () => {
    const days = cal.sessions({ from: utc('2026-01-05'), to: utc('2026-01-12') });
    expect(days).toHaveLength(5);
    expect(days[0]!.toISOString()).toBe(utc('2026-01-05').toISOString());
    expect(days[4]!.toISOString()).toBe(utc('2026-01-09').toISOString());
  });
});
