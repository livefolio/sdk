import { describe, it, expect } from 'vitest';
import { volatility } from './volatility';
import { computeVolatility } from '../../computations/volatility';
import type { Series } from '../../interfaces/types';
import type { DailyBar } from '../../handles/indicator';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const series: Series = [
  { t: utc('2026-01-05'), v: 100 },
  { t: utc('2026-01-06'), v: 110 },
  { t: utc('2026-01-07'), v: 105 },
  { t: utc('2026-01-08'), v: 115 },
];

describe('volatility', () => {
  it('computes period-2 volatility correctly', () => {
    // daily returns: 0.1, -0.04545..., 0.09523...
    // window [0.1, -0.04545...]: mean=(0.1 - 0.04545...)/2 = 0.02727...
    //   variance = ((0.1-0.02727...)^2 + (-0.04545...-0.02727...)^2) / 2
    const out = volatility(series, 2);
    expect(out).toHaveLength(2);
    // verify timestamps
    expect(out[0]!.t).toEqual(utc('2026-01-07'));
    expect(out[1]!.t).toEqual(utc('2026-01-08'));
    // positive and less than 1
    expect(out[0]!.v).toBeGreaterThan(0);
    expect(out[0]!.v).toBeLessThan(1);
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

  it('parity with v0.3 computeVolatility (tolerance 1e-12)', () => {
    const bars: DailyBar[] = [
      { date: '2026-01-05', value: 100 },
      { date: '2026-01-06', value: 102 },
      { date: '2026-01-07', value: 98 },
      { date: '2026-01-08', value: 105 },
      { date: '2026-01-09', value: 110 },
      { date: '2026-01-12', value: 107 },
      { date: '2026-01-13', value: 103 },
      { date: '2026-01-14', value: 108 },
      { date: '2026-01-15', value: 112 },
    ];
    const s: Series = bars.map((b) => ({ t: new Date(`${b.date}T00:00:00Z`), v: b.value }));
    const period = 4;
    const v3 = computeVolatility(bars, period);
    const v4 = volatility(s, period);
    expect(v4).toHaveLength(v3.length);
    for (let i = 0; i < v3.length; i++) {
      expect(Math.abs(v4[i]!.v - v3[i]!.value)).toBeLessThanOrEqual(1e-12);
    }
  });
});
