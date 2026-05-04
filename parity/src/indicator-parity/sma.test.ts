import { describe, it, expect } from 'vitest';
import { sma } from '@livefolio/sdk';
import type { Series } from '@livefolio/sdk';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const series: Series = [
  { t: utc('2026-01-05'), v: 1 },
  { t: utc('2026-01-06'), v: 2 },
  { t: utc('2026-01-07'), v: 3 },
  { t: utc('2026-01-08'), v: 4 },
  { t: utc('2026-01-09'), v: 5 },
];

describe('sma', () => {
  it('computes period-3 SMA correctly', () => {
    const out = sma(series, 3);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ t: utc('2026-01-07'), v: 2 });
    expect(out[1]).toEqual({ t: utc('2026-01-08'), v: 3 });
    expect(out[2]).toEqual({ t: utc('2026-01-09'), v: 4 });
  });

  it('returns empty when series is shorter than period', () => {
    expect(sma(series.slice(0, 2), 3)).toEqual([]);
  });

  it('throws on non-positive period', () => {
    expect(() => sma(series, 0)).toThrow();
    expect(() => sma(series, -1)).toThrow();
  });

  it('handles period=1 (identity-like)', () => {
    const out = sma(series, 1);
    expect(out).toHaveLength(5);
    expect(out[0]!.v).toBe(1);
    expect(out[4]!.v).toBe(5);
  });

  it('handles empty series', () => {
    expect(sma([], 3)).toEqual([]);
  });
});
