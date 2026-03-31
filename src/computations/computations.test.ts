// src/computations/computations.test.ts
import { describe, it, expect } from 'vitest';
import type { DailyBar } from '../handles/indicator.js';
import { computeSma } from './sma.js';
import { computeEma } from './ema.js';
import { computeRsi } from './rsi.js';
import { computeReturns } from './returns.js';
import { computeVolatility } from './volatility.js';
import { computeDrawdown } from './drawdown.js';
import { computeCalendar } from './calendar.js';
import { getComputation } from './index.js';

function makeBars(values: number[], startDate = '2025-01-01'): DailyBar[] {
  return values.map((value, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().split('T')[0], value };
  });
}

describe('computeSma', () => {
  it('computes simple moving average', () => {
    const bars = makeBars([10, 20, 30, 40, 50]);
    const result = computeSma(bars, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ date: '2025-01-03', value: 20 });
    expect(result[1]).toEqual({ date: '2025-01-04', value: 30 });
    expect(result[2]).toEqual({ date: '2025-01-05', value: 40 });
  });

  it('returns empty for insufficient data', () => {
    expect(computeSma(makeBars([10, 20]), 3)).toHaveLength(0);
  });
});

describe('computeEma', () => {
  it('computes exponential moving average', () => {
    const bars = makeBars([10, 20, 30, 40, 50]);
    const result = computeEma(bars, 3);
    expect(result).toHaveLength(3);
    expect(result[0].value).toBeCloseTo(20);
    expect(result[1].value).toBeCloseTo(30);
    expect(result[2].value).toBeCloseTo(40);
  });
});

describe('computeRsi', () => {
  it('computes relative strength index', () => {
    const prices = [
      44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
    ];
    const bars = makeBars(prices);
    const result = computeRsi(bars, 14);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeGreaterThan(0);
    expect(result[0].value).toBeLessThan(100);
  });

  it('returns empty for insufficient data', () => {
    expect(computeRsi(makeBars([10, 20, 30]), 14)).toHaveLength(0);
  });
});

describe('computeReturns', () => {
  it('computes percentage returns over lookback', () => {
    const bars = makeBars([100, 110, 121]);
    const result = computeReturns(bars, 1);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBeCloseTo(0.1);
    expect(result[1].value).toBeCloseTo(0.1);
  });

  it('supports multi-day lookback', () => {
    const bars = makeBars([100, 110, 121]);
    const result = computeReturns(bars, 2);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeCloseTo(0.21);
  });
});

describe('computeVolatility', () => {
  it('computes rolling standard deviation of daily returns', () => {
    const bars = makeBars([100, 102, 98, 103, 101]);
    const result = computeVolatility(bars, 3);
    expect(result.length).toBeGreaterThan(0);
    result.forEach((bar) => expect(bar.value).toBeGreaterThanOrEqual(0));
  });
});

describe('computeDrawdown', () => {
  it('computes drawdown from rolling max', () => {
    const bars = makeBars([100, 110, 105, 108, 90]);
    const result = computeDrawdown(bars, 4);
    expect(result.length).toBeGreaterThan(0);
    const last = result[result.length - 1];
    expect(last.value).toBeLessThan(0);
  });
});

describe('computeCalendar', () => {
  it('extracts month', () => {
    const bars: DailyBar[] = [
      { date: '2025-03-15', value: 0 },
      { date: '2025-06-20', value: 0 },
    ];
    const result = computeCalendar(bars, 'Month');
    expect(result).toEqual([
      { date: '2025-03-15', value: 3 },
      { date: '2025-06-20', value: 6 },
    ]);
  });

  it('extracts day of week (0=Sun, 6=Sat)', () => {
    const bars: DailyBar[] = [{ date: '2025-03-31', value: 0 }];
    const result = computeCalendar(bars, 'Day of Week');
    expect(result[0].value).toBe(1);
  });

  it('extracts day of month', () => {
    const bars: DailyBar[] = [{ date: '2025-03-15', value: 0 }];
    const result = computeCalendar(bars, 'Day of Month');
    expect(result[0].value).toBe(15);
  });

  it('extracts day of year', () => {
    const bars: DailyBar[] = [{ date: '2025-01-01', value: 0 }];
    const result = computeCalendar(bars, 'Day of Year');
    expect(result[0].value).toBe(1);
  });
});

describe('getComputation', () => {
  it('returns the right function for each type', () => {
    expect(getComputation('SMA')).toBe(computeSma);
    expect(getComputation('EMA')).toBe(computeEma);
    expect(getComputation('RSI')).toBe(computeRsi);
    expect(getComputation('Return')).toBe(computeReturns);
    expect(getComputation('Volatility')).toBe(computeVolatility);
    expect(getComputation('Drawdown')).toBe(computeDrawdown);
  });

  it('returns null for non-computed types', () => {
    expect(getComputation('Price')).toBeNull();
    expect(getComputation('VIX')).toBeNull();
    expect(getComputation('Threshold')).toBeNull();
  });
});
