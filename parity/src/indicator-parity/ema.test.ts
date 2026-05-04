import { describe, it, expect } from 'vitest';
import { ema } from '@livefolio/sdk';
import type { Series } from '@livefolio/sdk';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const series: Series = [
  { t: utc('2026-01-05'), v: 1 },
  { t: utc('2026-01-06'), v: 2 },
  { t: utc('2026-01-07'), v: 3 },
  { t: utc('2026-01-08'), v: 4 },
  { t: utc('2026-01-09'), v: 5 },
];

describe('ema', () => {
  // k = 2/(3+1) = 0.5
  // seed = (1+2+3)/3 = 2
  // i=3: 4*0.5 + 2*0.5 = 3
  // i=4: 5*0.5 + 3*0.5 = 4
  it('computes period-3 EMA correctly', () => {
    const out = ema(series, 3);
    expect(out).toHaveLength(3);
    expect(out[0]!.v).toBe(2);
    expect(out[1]!.v).toBe(3);
    expect(out[2]!.v).toBe(4);
    expect(out[0]!.t).toEqual(utc('2026-01-07'));
  });

  it('returns empty when series is shorter than period', () => {
    expect(ema(series.slice(0, 2), 3)).toEqual([]);
  });

  it('throws on non-positive period', () => {
    expect(() => ema(series, 0)).toThrow();
    expect(() => ema(series, -1)).toThrow();
  });

  it('handles empty series', () => {
    expect(ema([], 3)).toEqual([]);
  });
});
