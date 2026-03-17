import { describe, expect, it } from 'vitest';
import { computePerformanceMetrics } from './performance';

describe('computePerformanceMetrics', () => {
  it('returns null when fewer than 2 points', () => {
    expect(computePerformanceMetrics([])).toBeNull();
    expect(
      computePerformanceMetrics([{ timestampMs: Date.UTC(2026, 0, 2), value: 100 }]),
    ).toBeNull();
  });

  it('computes finite metrics for valid series', () => {
    const points = [
      { timestampMs: Date.UTC(2026, 0, 2), value: 100 },
      { timestampMs: Date.UTC(2026, 0, 3), value: 101 },
      { timestampMs: Date.UTC(2026, 0, 4), value: 99 },
      { timestampMs: Date.UTC(2026, 0, 5), value: 103 },
    ];
    const result = computePerformanceMetrics(points);

    expect(result).not.toBeNull();
    expect(result?.periodDays).toBe(3);
    expect(result?.maxDrawdown).toBeLessThanOrEqual(0);
    expect(Number.isFinite(result?.cagr ?? NaN)).toBe(true);
    expect(Number.isFinite(result?.volatility ?? NaN)).toBe(true);
    expect(Number.isFinite(result?.sharpe ?? NaN)).toBe(true);
  });
});
