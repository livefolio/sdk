import { describe, it, expect } from 'vitest';
import { rsi } from './rsi';
import { computeRsi } from '../../computations/rsi';
import type { Series } from '../../interfaces/types';
import type { DailyBar } from '../../handles/indicator';

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

  it('parity with v0.3 computeRsi (tolerance 1e-12)', () => {
    const bars: DailyBar[] = [
      { date: '2026-01-05', value: 100 },
      { date: '2026-01-06', value: 102 },
      { date: '2026-01-07', value: 101 },
      { date: '2026-01-08', value: 105 },
      { date: '2026-01-09', value: 103 },
      { date: '2026-01-12', value: 108 },
      { date: '2026-01-13', value: 107 },
      { date: '2026-01-14', value: 110 },
      { date: '2026-01-15', value: 109 },
      { date: '2026-01-16', value: 112 },
      { date: '2026-01-19', value: 111 },
      { date: '2026-01-20', value: 115 },
      { date: '2026-01-21', value: 114 },
      { date: '2026-01-22', value: 118 },
      { date: '2026-01-23', value: 116 },
      { date: '2026-01-26', value: 120 },
    ];
    const s: Series = bars.map((b) => ({ t: new Date(`${b.date}T00:00:00Z`), v: b.value }));
    const period = 14;
    const v3 = computeRsi(bars, period);
    const v4 = rsi(s, period);
    expect(v4).toHaveLength(v3.length);
    for (let i = 0; i < v3.length; i++) {
      expect(Math.abs(v4[i]!.v - v3[i]!.value)).toBeLessThanOrEqual(1e-12);
    }
  });

  it('parity with v0.3 computeRsi on mixed up/down fixture (tolerance 1e-12)', () => {
    const bars: DailyBar[] = [
      { date: '2026-01-05', value: 44.34 },
      { date: '2026-01-06', value: 44.09 },
      { date: '2026-01-07', value: 44.15 },
      { date: '2026-01-08', value: 43.61 },
      { date: '2026-01-09', value: 44.33 },
      { date: '2026-01-12', value: 44.83 },
      { date: '2026-01-13', value: 45.1 },
      { date: '2026-01-14', value: 45.15 },
      { date: '2026-01-15', value: 43.61 },
      { date: '2026-01-16', value: 44.33 },
      { date: '2026-01-19', value: 44.83 },
      { date: '2026-01-20', value: 45.1 },
      { date: '2026-01-21', value: 45.15 },
      { date: '2026-01-22', value: 46.92 },
      { date: '2026-01-23', value: 46.75 },
      { date: '2026-01-26', value: 47.2 },
      { date: '2026-01-27', value: 46.57 },
    ];
    const s: Series = bars.map((b) => ({ t: new Date(`${b.date}T00:00:00Z`), v: b.value }));
    const period = 14;
    const v3 = computeRsi(bars, period);
    const v4 = rsi(s, period);
    expect(v4).toHaveLength(v3.length);
    for (let i = 0; i < v3.length; i++) {
      expect(Math.abs(v4[i]!.v - v3[i]!.value)).toBeLessThanOrEqual(1e-12);
    }
  });
});
