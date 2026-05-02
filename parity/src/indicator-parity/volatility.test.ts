import { describe, it, expect } from 'vitest';
import { volatility } from '@livefolio/sdk';
import type { Series } from '@livefolio/sdk';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const series: Series = [
  { t: utc('2026-01-05'), v: 100 },
  { t: utc('2026-01-06'), v: 110 },
  { t: utc('2026-01-07'), v: 105 },
  { t: utc('2026-01-08'), v: 115 },
];

describe('volatility', () => {
  it('computes period-2 volatility correctly', () => {
    // daily returns: 0.1, -1/22, 10/105
    // population stdev of each 2-element window
    const out = volatility(series, 2);
    expect(out).toHaveLength(2);
    expect(out[0]!.t).toEqual(utc('2026-01-07'));
    expect(out[1]!.t).toEqual(utc('2026-01-08'));
    expect(out[0]!.v).toBeCloseTo(0.07272727272727272, 12);
    expect(out[1]!.v).toBeCloseTo(0.07034632034632035, 12);
  });

  it('returns empty when series has fewer than period+1 points', () => {
    expect(volatility(series.slice(0, 2), 3)).toEqual([]);
  });

  it('returns empty for empty series', () => {
    expect(volatility([], 2)).toEqual([]);
  });

  it('throws on non-positive period', () => {
    expect(() => volatility(series, 0)).toThrow();
    expect(() => volatility(series, -1)).toThrow();
  });
});
