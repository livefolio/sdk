import { describe, it, expect } from 'vitest';
import { drawdown } from './drawdown';
import { computeDrawdown } from '../../computations/drawdown';
import type { Series } from '../../interfaces/types';
import type { DailyBar } from '../../handles/indicator';

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

  it('parity with v0.3 computeDrawdown (tolerance 0)', () => {
    const bars: DailyBar[] = [
      { date: '2026-01-05', value: 100 },
      { date: '2026-01-06', value: 90 },
      { date: '2026-01-07', value: 80 },
      { date: '2026-01-08', value: 110 },
      { date: '2026-01-09', value: 95 },
      { date: '2026-01-12', value: 105 },
      { date: '2026-01-13', value: 85 },
    ];
    const s: Series = bars.map((b) => ({ t: new Date(`${b.date}T00:00:00Z`), v: b.value }));
    const v3 = computeDrawdown(bars, 4);
    const v4 = drawdown(s, 4);
    expect(v4).toHaveLength(v3.length);
    for (let i = 0; i < v3.length; i++) {
      expect(v4[i]!.v).toBe(v3[i]!.value);
    }
  });
});
