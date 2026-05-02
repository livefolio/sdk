import { describe, it, expect } from 'vitest';
import { rsi } from '@livefolio/sdk';
import type { Series } from '@livefolio/sdk';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

describe('rsi', () => {
  it('returns empty when series has fewer than period+1 points', () => {
    const s: Series = [
      { t: utc('2026-01-05'), v: 100 },
      { t: utc('2026-01-06'), v: 102 },
      { t: utc('2026-01-07'), v: 101 },
    ];
    expect(rsi(s, 3)).toEqual([]);
    expect(rsi(s, 4)).toEqual([]);
  });

  it('returns empty for empty series', () => {
    expect(rsi([], 14)).toEqual([]);
  });

  it('throws on non-positive period', () => {
    const s: Series = [{ t: utc('2026-01-05'), v: 100 }];
    expect(() => rsi(s, 0)).toThrow();
    expect(() => rsi(s, -1)).toThrow();
  });

  it('returns 100 when all changes are gains (no losses)', () => {
    const s: Series = [
      { t: utc('2026-01-05'), v: 10 },
      { t: utc('2026-01-06'), v: 20 },
      { t: utc('2026-01-07'), v: 30 },
      { t: utc('2026-01-08'), v: 40 },
    ];
    const out = rsi(s, 3);
    expect(out[0]!.v).toBe(100);
  });

  it('timestamps align with series input points', () => {
    const s: Series = [
      { t: utc('2026-01-05'), v: 100 },
      { t: utc('2026-01-06'), v: 102 },
      { t: utc('2026-01-07'), v: 101 },
      { t: utc('2026-01-08'), v: 104 },
    ];
    // period=2: first output at series[2], second at series[3]
    const out = rsi(s, 2);
    expect(out).toHaveLength(2);
    expect(out[0]!.t).toEqual(utc('2026-01-07'));
    expect(out[1]!.t).toEqual(utc('2026-01-08'));
  });
});
