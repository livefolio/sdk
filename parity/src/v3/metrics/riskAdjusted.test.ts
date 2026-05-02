import { describe, it, expect } from 'vitest';
import { dailyRiskFree, sharpe, sortino, calmar } from './riskAdjusted';
import { mean, stdev } from './risk';

describe('dailyRiskFree', () => {
  it('compounds back to annual', () => {
    const d = dailyRiskFree(0.04);
    expect(Math.pow(1 + d, 252)).toBeCloseTo(1.04, 8);
  });
});

describe('sharpe', () => {
  it('matches manual computation with rf=0', () => {
    const r = [0.01, -0.005, 0.02, -0.01, 0.005];
    const m = mean(r);
    const s = stdev(r);
    expect(sharpe(r, 0)).toBeCloseTo((m / s) * Math.sqrt(252), 8);
  });

  it('NaN when stdev is 0', () => {
    expect(Number.isNaN(sharpe([0.001, 0.001, 0.001], 0))).toBe(true);
  });
});

describe('sortino', () => {
  it('finite for typical input, NaN when no downside', () => {
    expect(Number.isFinite(sortino([0.01, -0.005, 0.02, -0.01, 0.005], 0))).toBe(true);
    expect(Number.isNaN(sortino([0.01, 0.02, 0.03], 0))).toBe(true);
  });
});

describe('calmar', () => {
  it('cagr / |maxDD|', () => {
    expect(calmar(0.1, -0.2)).toBeCloseTo(0.5, 10);
  });
  it('Infinity when maxDD is 0', () => {
    expect(calmar(0.1, 0)).toBe(Infinity);
  });
});
