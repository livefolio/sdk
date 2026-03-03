import { describe, it, expect } from 'vitest';
import {
  computeSeriesStats,
  computeAlphaVsSpy,
  filterByRange,
  normalizeTo100,
  getAlignmentDate,
  getValueAtDate,
  trimAndNormalizeToAlignment,
  returnFromAlignedPoints,
  computeReturnsFromPoints,
} from './performance';
import type { PerformancePoint, DateValuePoint } from './types';

// ---------------------------------------------------------------------------
// computeSeriesStats
// ---------------------------------------------------------------------------

describe('computeSeriesStats', () => {
  it('returns zeros for fewer than 2 points', () => {
    const stats = computeSeriesStats([]);
    expect(stats.sinceInceptionReturn).toBe(0);
    expect(stats.cagr).toBe(0);
    expect(stats.maxDrawdown).toBe(0);
    expect(stats.sharpe).toBe(0);
    expect(stats.recentTrades).toEqual([]);
  });

  it('computes since-inception return', () => {
    const points: PerformancePoint[] = [
      { date: '2024-01-02', value: 100, allocation: 'A' },
      { date: '2024-06-02', value: 110, allocation: 'A' },
      { date: '2025-01-02', value: 120, allocation: 'A' },
    ];
    const stats = computeSeriesStats(points);
    expect(stats.sinceInceptionReturn).toBeCloseTo(20, 1);
  });

  it('computes CAGR', () => {
    // 100 → 200 over exactly 1 year = 100% CAGR
    const points: PerformancePoint[] = [
      { date: '2024-01-02', value: 100, allocation: 'A' },
      { date: '2025-01-02', value: 200, allocation: 'A' },
    ];
    const stats = computeSeriesStats(points);
    expect(stats.cagr).toBeCloseTo(100, 0);
  });

  it('computes max drawdown as negative percentage', () => {
    const points: PerformancePoint[] = [
      { date: '2024-01-02', value: 100, allocation: 'A' },
      { date: '2024-01-03', value: 110, allocation: 'A' },
      { date: '2024-01-04', value: 88, allocation: 'A' }, // 20% drawdown from peak 110
      { date: '2024-01-05', value: 95, allocation: 'A' },
    ];
    const stats = computeSeriesStats(points);
    expect(stats.maxDrawdown).toBeCloseTo(-20, 0);
  });

  it('computes volatility > 0 for varying returns', () => {
    const points: PerformancePoint[] = [
      { date: '2024-01-02', value: 100, allocation: 'A' },
      { date: '2024-01-03', value: 105, allocation: 'A' },
      { date: '2024-01-04', value: 95, allocation: 'A' },
      { date: '2024-01-05', value: 103, allocation: 'A' },
    ];
    const stats = computeSeriesStats(points);
    expect(stats.volatility).toBeGreaterThan(0);
  });

  it('computes positive Sharpe for consistently rising series', () => {
    const points: PerformancePoint[] = [];
    for (let i = 0; i < 100; i++) {
      points.push({
        date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
        value: 100 * Math.pow(1.001, i),
        allocation: 'A',
      });
    }
    const stats = computeSeriesStats(points);
    expect(stats.sharpe).toBeGreaterThan(0);
  });

  it('tracks recent trades (allocation changes)', () => {
    const points: PerformancePoint[] = [
      { date: '2024-01-02', value: 100, allocation: 'A' },
      { date: '2024-01-03', value: 101, allocation: 'A' },
      { date: '2024-01-04', value: 102, allocation: 'B' },
      { date: '2024-01-05', value: 103, allocation: 'B' },
      { date: '2024-01-06', value: 104, allocation: 'A' },
    ];
    const stats = computeSeriesStats(points);
    expect(stats.recentTrades).toHaveLength(2);
    expect(stats.recentTrades[0]).toEqual({ date: '2024-01-06', from: 'B', to: 'A' }); // Most recent first
    expect(stats.recentTrades[1]).toEqual({ date: '2024-01-04', from: 'A', to: 'B' });
    expect(stats.lastTriggerDate).toBe('2024-01-06');
  });

  it('limits recent trades to specified count', () => {
    const points: PerformancePoint[] = [];
    for (let i = 0; i < 20; i++) {
      points.push({
        date: `2024-01-${String(i + 1).padStart(2, '0')}`,
        value: 100 + i,
        allocation: i % 2 === 0 ? 'A' : 'B',
      });
    }
    const stats = computeSeriesStats(points, 3);
    expect(stats.recentTrades).toHaveLength(3);
  });

  it('computes recovery time', () => {
    const points: PerformancePoint[] = [
      { date: '2024-01-01', value: 100, allocation: 'A' },
      { date: '2024-01-02', value: 110, allocation: 'A' }, // peak
      { date: '2024-01-03', value: 95, allocation: 'A' },  // drawdown
      { date: '2024-01-04', value: 90, allocation: 'A' },  // trough (idx=3)
      { date: '2024-01-05', value: 100, allocation: 'A' },
      { date: '2024-01-06', value: 111, allocation: 'A' }, // recovery (idx=5), 5-3=2 days
    ];
    const stats = computeSeriesStats(points);
    expect(stats.recoveryTime).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// computeAlphaVsSpy
// ---------------------------------------------------------------------------

describe('computeAlphaVsSpy', () => {
  it('returns null for insufficient data', () => {
    expect(computeAlphaVsSpy([], [])).toBeNull();
    expect(computeAlphaVsSpy(
      [{ date: '2024-01-01', value: 100, allocation: 'A' }],
      [{ date: '2024-01-01', value: 100 }],
    )).toBeNull();
  });

  it('computes positive alpha when strategy outperforms', () => {
    const strategy: PerformancePoint[] = [
      { date: '2024-01-01', value: 100, allocation: 'A' },
      { date: '2024-12-31', value: 130, allocation: 'A' },
    ];
    const spy: DateValuePoint[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-12-31', value: 110 },
    ];
    expect(computeAlphaVsSpy(strategy, spy)).toBeCloseTo(20, 1); // 30% - 10%
  });

  it('computes negative alpha when SPY outperforms', () => {
    const strategy: PerformancePoint[] = [
      { date: '2024-01-01', value: 100, allocation: 'A' },
      { date: '2024-12-31', value: 105, allocation: 'A' },
    ];
    const spy: DateValuePoint[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-12-31', value: 120 },
    ];
    expect(computeAlphaVsSpy(strategy, spy)).toBeCloseTo(-15, 1);
  });
});

// ---------------------------------------------------------------------------
// normalizeTo100
// ---------------------------------------------------------------------------

describe('normalizeTo100', () => {
  it('returns empty for empty input', () => {
    expect(normalizeTo100([])).toEqual([]);
  });

  it('normalizes first value to 100', () => {
    const points: DateValuePoint[] = [
      { date: '2024-01-01', value: 50 },
      { date: '2024-01-02', value: 75 },
      { date: '2024-01-03', value: 100 },
    ];
    const result = normalizeTo100(points);
    expect(result[0].value).toBe(100);
    expect(result[1].value).toBe(150);
    expect(result[2].value).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// getAlignmentDate
// ---------------------------------------------------------------------------

describe('getAlignmentDate', () => {
  it('returns null for empty series', () => {
    expect(getAlignmentDate([])).toBeNull();
  });

  it('returns the latest first date across series', () => {
    const series = [
      { points: [{ date: '2024-01-01', value: 100 }, { date: '2024-01-02', value: 101 }] },
      { points: [{ date: '2024-01-03', value: 100 }, { date: '2024-01-04', value: 101 }] },
    ];
    expect(getAlignmentDate(series)).toBe('2024-01-03');
  });
});

// ---------------------------------------------------------------------------
// getValueAtDate
// ---------------------------------------------------------------------------

describe('getValueAtDate', () => {
  it('returns exact match', () => {
    const points: DateValuePoint[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-03', value: 110 },
    ];
    expect(getValueAtDate(points, '2024-01-01')).toBe(100);
  });

  it('interpolates between points', () => {
    const points: DateValuePoint[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-03', value: 110 },
    ];
    // 2024-01-02 is halfway between 01-01 and 01-03
    expect(getValueAtDate(points, '2024-01-02')).toBeCloseTo(105, 1);
  });

  it('returns null for empty array', () => {
    expect(getValueAtDate([], '2024-01-01')).toBeNull();
  });

  it('returns boundary values for out-of-range dates', () => {
    const points: DateValuePoint[] = [
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 110 },
    ];
    expect(getValueAtDate(points, '2024-01-01')).toBe(100); // Before first
    expect(getValueAtDate(points, '2024-01-04')).toBe(110); // After last
  });
});

// ---------------------------------------------------------------------------
// trimAndNormalizeToAlignment
// ---------------------------------------------------------------------------

describe('trimAndNormalizeToAlignment', () => {
  it('normalizes so alignment date value = 100', () => {
    const points: DateValuePoint[] = [
      { date: '2024-01-01', value: 50 },
      { date: '2024-01-02', value: 75 },
      { date: '2024-01-03', value: 100 },
    ];
    const result = trimAndNormalizeToAlignment(points, '2024-01-02');
    expect(result[0].date).toBe('2024-01-02');
    expect(result[0].value).toBeCloseTo(100, 5);
    expect(result[1].value).toBeCloseTo(133.33, 1);
  });

  it('returns empty for zero reference value', () => {
    const points: DateValuePoint[] = [
      { date: '2024-01-01', value: 0 },
      { date: '2024-01-02', value: 100 },
    ];
    expect(trimAndNormalizeToAlignment(points, '2024-01-01')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// returnFromAlignedPoints
// ---------------------------------------------------------------------------

describe('returnFromAlignedPoints', () => {
  it('returns null for empty input', () => {
    expect(returnFromAlignedPoints([])).toBeNull();
  });

  it('computes return from 100-normalized series', () => {
    const points: DateValuePoint[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-12-31', value: 115 },
    ];
    expect(returnFromAlignedPoints(points)).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// filterByRange
// ---------------------------------------------------------------------------

describe('filterByRange', () => {
  const now = new Date();
  const thisYear = now.getFullYear();

  it('filters YTD', () => {
    const points: DateValuePoint[] = [
      { date: `${thisYear - 1}-12-31`, value: 100 },
      { date: `${thisYear}-01-02`, value: 101 },
      { date: `${thisYear}-06-15`, value: 110 },
    ];
    const result = filterByRange(points, 'ytd');
    expect(result.every((p) => p.date >= `${thisYear}-01-01`)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('filters 1y', () => {
    const points: DateValuePoint[] = [
      { date: `${thisYear - 2}-01-01`, value: 90 },
      { date: `${thisYear - 1}-06-01`, value: 100 },
      { date: `${thisYear}-01-01`, value: 110 },
    ];
    const result = filterByRange(points, '1y');
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// computeReturnsFromPoints
// ---------------------------------------------------------------------------

describe('computeReturnsFromPoints', () => {
  it('returns nulls for empty input', () => {
    const result = computeReturnsFromPoints([]);
    expect(result.returnYTD).toBeNull();
    expect(result.return1y).toBeNull();
    expect(result.return3y).toBeNull();
  });
});
