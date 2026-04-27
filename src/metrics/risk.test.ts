import { describe, it, expect } from 'vitest';
import {
  mean,
  stdev,
  volatility,
  downsideDeviation,
  skewness,
  excessKurtosis,
  historicalVar,
  historicalCvar,
  ulcerIndex,
} from './risk';
import type { DailyBar } from '../handles/indicator';

describe('mean / stdev', () => {
  it('mean of [1,2,3,4,5] = 3', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });
  it('sample stdev of [2,4,4,4,5,5,7,9] ≈ 2.138 (divide by n-1)', () => {
    // population stdev = 2, but sample stdev (n-1) ≈ 2.138
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138089935299395, 10);
  });
});

describe('volatility', () => {
  it('annualizes daily stdev by sqrt(252)', () => {
    const r = [0.01, -0.01, 0.02, -0.02, 0, 0.01, -0.01];
    expect(volatility(r)).toBeCloseTo(stdev(r) * Math.sqrt(252), 10);
  });
});

describe('downsideDeviation', () => {
  it('only negative deviations from MAR contribute', () => {
    // r=[-0.02, 0.01, -0.03, 0.05], MAR=0
    // squared deviations: 0.0004, 0, 0.0009, 0; mean = 0.000325
    const r = [-0.02, 0.01, -0.03, 0.05];
    expect(downsideDeviation(r, 0)).toBeCloseTo(Math.sqrt(0.000325) * Math.sqrt(252), 10);
  });
});

describe('skewness / excessKurtosis', () => {
  it('symmetric data has near-zero skew', () => {
    expect(Math.abs(skewness([-2, -1, 0, 1, 2]))).toBeLessThan(1e-10);
  });
  it('excess kurtosis runs and gives a finite number', () => {
    expect(Number.isFinite(excessKurtosis([-2, -1, 0, 1, 2, -1, 1, 0, 0]))).toBe(true);
  });
});

describe('historicalVar / Cvar', () => {
  it('VaR95 / CVaR95 on 20 returns return positive loss magnitudes; CVaR >= VaR', () => {
    const r = [
      -0.1, -0.08, -0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.02, 0.03, 0.03, 0.04, 0.04, 0.05, 0.05, 0.06,
      0.06, 0.07,
    ];
    expect(historicalVar(r, 0.95)).toBeGreaterThan(0);
    expect(historicalCvar(r, 0.95)).toBeGreaterThanOrEqual(historicalVar(r, 0.95));
  });
});

describe('ulcerIndex', () => {
  it('returns 0 for monotonically increasing series', () => {
    const s: DailyBar[] = [
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 101 },
      { date: '2024-01-04', value: 102 },
    ];
    expect(ulcerIndex(s)).toBeCloseTo(0, 10);
  });
  it('non-zero for series with drawdown', () => {
    const s: DailyBar[] = [
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 90 },
      { date: '2024-01-04', value: 100 },
    ];
    // pct drawdowns: 0, -10, 0; mean(squared) = (0+100+0)/3; sqrt ≈ 5.77
    expect(ulcerIndex(s)).toBeCloseTo(Math.sqrt(100 / 3), 6);
  });
});
