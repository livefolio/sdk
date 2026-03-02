import { describe, it, expect } from 'vitest';
import { utcToET, isAtMarketClose } from './time';

// ---------------------------------------------------------------------------
// utcToET
// ---------------------------------------------------------------------------

describe('utcToET', () => {
  it('converts UTC to Eastern Time during EST (winter)', () => {
    // 2025-01-10 21:00 UTC = 2025-01-10 16:00 ET (EST, UTC-5)
    const result = utcToET(new Date('2025-01-10T21:00:00.000Z'));
    expect(result).toEqual({ year: 2025, month: 1, day: 10, hour: 16, minute: 0 });
  });

  it('converts UTC to Eastern Time during EDT (summer)', () => {
    // 2025-07-10 20:00 UTC = 2025-07-10 16:00 ET (EDT, UTC-4)
    const result = utcToET(new Date('2025-07-10T20:00:00.000Z'));
    expect(result).toEqual({ year: 2025, month: 7, day: 10, hour: 16, minute: 0 });
  });

  it('handles date rollover at midnight UTC → previous day ET', () => {
    // 2025-01-11 02:00 UTC = 2025-01-10 21:00 ET (EST)
    const result = utcToET(new Date('2025-01-11T02:00:00.000Z'));
    expect(result.day).toBe(10);
    expect(result.hour).toBe(21);
  });

  it('handles year boundary', () => {
    // 2025-01-01 05:00 UTC = 2025-01-01 00:00 ET (EST, midnight)
    const result = utcToET(new Date('2025-01-01T05:00:00.000Z'));
    expect(result.year).toBe(2025);
    expect(result.month).toBe(1);
    expect(result.day).toBe(1);
    expect(result.hour).toBe(0);
  });

  it('preserves minutes', () => {
    const result = utcToET(new Date('2025-01-10T21:30:00.000Z'));
    expect(result.minute).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// isAtMarketClose
// ---------------------------------------------------------------------------

describe('isAtMarketClose', () => {
  it('returns true at 4:00 PM ET (regular close)', () => {
    // 21:00 UTC in winter = 16:00 ET
    expect(isAtMarketClose(new Date('2025-01-10T21:00:00.000Z'))).toBe(true);
  });

  it('returns true at 1:00 PM ET (early close)', () => {
    // 18:00 UTC in winter = 13:00 ET
    expect(isAtMarketClose(new Date('2025-01-10T18:00:00.000Z'))).toBe(true);
  });

  it('returns false at other times', () => {
    // 15:00 UTC in winter = 10:00 ET
    expect(isAtMarketClose(new Date('2025-01-10T15:00:00.000Z'))).toBe(false);
  });

  it('returns false at 4:01 PM ET', () => {
    expect(isAtMarketClose(new Date('2025-01-10T21:01:00.000Z'))).toBe(false);
  });

  it('handles EDT (summer) 4:00 PM ET = 20:00 UTC', () => {
    expect(isAtMarketClose(new Date('2025-07-10T20:00:00.000Z'))).toBe(true);
  });
});

