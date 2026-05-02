import { describe, it, expect } from 'vitest';
import { sma } from '@livefolio/sdk';
import type { Series } from '@livefolio/sdk';
import { computeSma } from '../v3/computations/sma';
import type { DailyBar } from '../v3/handles/indicator';

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

  it('parity with v0.3 computeSma', () => {
    const bars: DailyBar[] = [
      { date: '2026-01-05', value: 10 },
      { date: '2026-01-06', value: 20 },
      { date: '2026-01-07', value: 30 },
      { date: '2026-01-08', value: 25 },
      { date: '2026-01-09', value: 15 },
      { date: '2026-01-12', value: 35 },
      { date: '2026-01-13', value: 40 },
    ];
    const s: Series = bars.map((b) => ({ t: new Date(`${b.date}T00:00:00Z`), v: b.value }));
    const v3 = computeSma(bars, 3);
    const v4 = sma(s, 3);
    expect(v4).toHaveLength(v3.length);
    for (let i = 0; i < v3.length; i++) {
      expect(v4[i]!.v).toBe(v3[i]!.value);
    }
  });
});
