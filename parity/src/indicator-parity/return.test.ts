import { describe, it, expect } from 'vitest';
import { returnSeries } from '@livefolio/sdk';
import type { Series } from '@livefolio/sdk';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const series: Series = [
  { t: utc('2026-01-05'), v: 100 },
  { t: utc('2026-01-06'), v: 110 },
  { t: utc('2026-01-07'), v: 105 },
  { t: utc('2026-01-08'), v: 120 },
  { t: utc('2026-01-09'), v: 90 },
];

describe('returnSeries', () => {
  it('computes period-1 pct returns correctly', () => {
    const out = returnSeries(series, 1);
    expect(out).toHaveLength(4);
    // (110-100)/100 = 0.1
    expect(out[0]!.v).toBeCloseTo(0.1, 12);
    // (105-110)/110 = -5/110
    expect(out[1]!.v).toBeCloseTo(-5 / 110, 12);
    expect(out[0]!.t).toEqual(utc('2026-01-06'));
  });

  it('computes period-2 pct returns correctly', () => {
    const out = returnSeries(series, 2);
    expect(out).toHaveLength(3);
    // (105-100)/100 = 0.05
    expect(out[0]!.v).toBeCloseTo(0.05, 12);
    expect(out[0]!.t).toEqual(utc('2026-01-07'));
  });

  it('computes abs mode correctly', () => {
    const out = returnSeries(series, 1, 'abs');
    expect(out).toHaveLength(4);
    expect(out[0]!.v).toBe(10); // 110 - 100
    expect(out[1]!.v).toBe(-5); // 105 - 110
  });

  it('returns empty when series length equals period', () => {
    expect(returnSeries(series.slice(0, 3), 3)).toEqual([]);
  });

  it('returns empty when series is shorter than period', () => {
    expect(returnSeries(series.slice(0, 2), 3)).toEqual([]);
  });

  it('returns empty for empty series', () => {
    expect(returnSeries([], 1)).toEqual([]);
  });

  it('throws on non-positive period', () => {
    expect(() => returnSeries(series, 0)).toThrow();
    expect(() => returnSeries(series, -1)).toThrow();
  });
});
