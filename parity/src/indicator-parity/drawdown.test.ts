import { describe, it, expect } from 'vitest';
import { drawdown } from '@livefolio/sdk';
import type { Series } from '@livefolio/sdk';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const series: Series = [
  { t: utc('2026-01-05'), v: 100 },
  { t: utc('2026-01-06'), v: 90 },
  { t: utc('2026-01-07'), v: 80 },
  { t: utc('2026-01-08'), v: 110 },
  { t: utc('2026-01-09'), v: 95 },
];

describe('drawdown', () => {
  it('computes period-3 drawdown correctly', () => {
    const out = drawdown(series, 3);
    // period 3: windows are [100,90,80], [90,80,110], [80,110,95]
    // [100,90,80]: max=100, dd=(80-100)/100 = -0.2
    // [90,80,110]: max=110, dd=(110-110)/110 = 0
    // [80,110,95]: max=110, dd=(95-110)/110 = -15/110
    expect(out).toHaveLength(3);
    expect(out[0]!.v).toBe(-0.2);
    expect(out[1]!.v).toBe(0);
    expect(out[2]!.v).toBeCloseTo(-15 / 110, 12);
    expect(out[0]!.t).toEqual(utc('2026-01-07'));
  });

  it('returns empty when series shorter than period', () => {
    expect(drawdown(series.slice(0, 2), 3)).toEqual([]);
  });

  it('returns empty for empty series', () => {
    expect(drawdown([], 3)).toEqual([]);
  });

  it('throws on non-positive period', () => {
    expect(() => drawdown(series, 0)).toThrow();
    expect(() => drawdown(series, -1)).toThrow();
  });

  it('period-1 returns all zeros (each point is its own max)', () => {
    const out = drawdown(series, 1);
    expect(out).toHaveLength(5);
    for (const pt of out) {
      expect(pt.v).toBe(0);
    }
  });
});
