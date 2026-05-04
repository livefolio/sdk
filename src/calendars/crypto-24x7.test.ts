import { describe, it, expect } from 'vitest';
import { Crypto24x7Calendar } from './crypto-24x7';

describe('Crypto24x7Calendar', () => {
  const cal = new Crypto24x7Calendar();

  it('isOpen is true for any instant', () => {
    expect(cal.isOpen(new Date('2024-06-03T00:00:00Z'))).toBe(true);
    expect(cal.isOpen(new Date('2024-06-03T12:34:56Z'))).toBe(true);
    expect(cal.isOpen(new Date('2024-12-25T08:00:00Z'))).toBe(true); // Christmas
    expect(cal.isOpen(new Date('2024-06-08T00:00:00Z'))).toBe(true); // Saturday
  });

  it('next returns midnight UTC of the following day', () => {
    expect(cal.next(new Date('2024-06-03T15:00:00Z')).toISOString()).toBe('2024-06-04T00:00:00.000Z');
    expect(cal.next(new Date('2024-06-03T00:00:00Z')).toISOString()).toBe('2024-06-04T00:00:00.000Z');
  });

  it('previous returns midnight UTC of the preceding day', () => {
    expect(cal.previous(new Date('2024-06-03T15:00:00Z')).toISOString()).toBe('2024-06-02T00:00:00.000Z');
    expect(cal.previous(new Date('2024-06-03T00:00:00Z')).toISOString()).toBe('2024-06-02T00:00:00.000Z');
  });

  it('sessions returns every day in the half-open range', () => {
    const days = cal.sessions({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-08T00:00:00Z'),
    });
    expect(days).toHaveLength(7);
    expect(days[0]?.toISOString()).toBe('2024-06-01T00:00:00.000Z');
    expect(days[6]?.toISOString()).toBe('2024-06-07T00:00:00.000Z');
  });

  it('sessions returns empty for a zero-length range', () => {
    const days = cal.sessions({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-01T00:00:00Z'),
    });
    expect(days).toEqual([]);
  });

  it('schedule returns sessions spanning midnight to midnight', () => {
    const sched = cal.schedule({
      from: new Date('2024-06-01T00:00:00Z'),
      to: new Date('2024-06-03T00:00:00Z'),
    });
    expect(sched).toHaveLength(2);
    expect(sched[0]).toEqual({
      date: new Date('2024-06-01T00:00:00.000Z'),
      open: new Date('2024-06-01T00:00:00.000Z'),
      close: new Date('2024-06-02T00:00:00.000Z'),
    });
  });

  it('isEarlyClose is always false', () => {
    expect(cal.isEarlyClose(new Date('2024-11-29T00:00:00Z'))).toBe(false);
  });
});
