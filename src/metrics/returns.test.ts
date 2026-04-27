import { describe, it, expect } from 'vitest';
import { dailyReturns, monthlyReturns, yearlyReturns } from './returns';
import type { DailyBar } from '../handles/indicator';

const bars = (entries: Array<[string, number]>): DailyBar[] => entries.map(([date, value]) => ({ date, value }));

describe('dailyReturns', () => {
  it('returns N-1 returns for N bars', () => {
    const r = dailyReturns(
      bars([
        ['2024-01-02', 100],
        ['2024-01-03', 110],
        ['2024-01-04', 99],
      ]),
    );
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
  });
});

describe('monthlyReturns', () => {
  it('produces one entry per month spanned, marking partial first/last', () => {
    const r = monthlyReturns(
      bars([
        ['2024-01-15', 100],
        ['2024-01-31', 110],
        ['2024-02-29', 121],
        ['2024-03-15', 130],
      ]),
    );
    expect(r).toHaveLength(3);
    expect(r[0]!.year).toBe(2024);
    expect(r[0]!.month).toBe(0);
    expect(r[0]!.return).toBeCloseTo(0.1, 10);
    expect(r[0]!.partial).toBe(true);
    expect(r[1]!.partial).toBe(false);
    expect(r[1]!.return).toBeCloseTo(0.1, 10);
    expect(r[2]!.partial).toBe(true);
  });

  it('single full month returns one non-partial entry', () => {
    const r = monthlyReturns(
      bars([
        ['2024-01-01', 100],
        ['2024-01-31', 105],
      ]),
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.year).toBe(2024);
    expect(r[0]!.month).toBe(0);
    expect(r[0]!.return).toBeCloseTo(0.05, 10);
    expect(r[0]!.partial).toBe(false);
  });
});

describe('yearlyReturns', () => {
  it('marks first/last year partial when not full-year span', () => {
    const r = yearlyReturns(
      bars([
        ['2023-06-01', 100],
        ['2023-12-29', 110],
        ['2024-12-31', 121],
        ['2025-03-15', 130],
      ]),
    );
    expect(r).toHaveLength(3);
    expect(r[0]!.year).toBe(2023);
    expect(r[0]!.return).toBeCloseTo(0.1, 10);
    expect(r[0]!.partial).toBe(true);
    expect(r[1]!.year).toBe(2024);
    expect(r[1]!.return).toBeCloseTo(0.1, 10);
    expect(r[1]!.partial).toBe(false);
    expect(r[2]!.partial).toBe(true);
  });
});
