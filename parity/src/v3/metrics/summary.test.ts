import { describe, it, expect } from 'vitest';
import { totalReturn, cagr, bestYear, worstYear, bestMonth, worstMonth, pctPositiveMonths } from './summary';
import { yearlyReturns, monthlyReturns } from './returns';
import type { DailyBar } from '../handles/indicator';

const bars = (entries: Array<[string, number]>): DailyBar[] => entries.map(([date, value]) => ({ date, value }));

describe('totalReturn / cagr', () => {
  it('totalReturn = last/first - 1', () => {
    expect(
      totalReturn(
        bars([
          ['2024-01-01', 100],
          ['2024-12-31', 121],
        ]),
      ),
    ).toBeCloseTo(0.21, 10);
  });

  it('cagr scales by fractional years', () => {
    const s = bars([
      ['2023-01-01', 100],
      ['2025-01-01', 121],
    ]);
    expect(cagr(s)).toBeCloseTo(0.1, 3);
  });
});

describe('best/worst year & month', () => {
  it('best/worstYear ignore partial years', () => {
    const s = bars([
      ['2023-06-01', 100],
      ['2023-12-29', 90],
      ['2024-12-31', 108],
      ['2025-03-15', 130],
    ]);
    const yr = yearlyReturns(s);
    expect(bestYear(yr)?.year).toBe(2024);
    expect(bestYear(yr)?.return).toBeCloseTo(0.2, 10);
    expect(worstYear(yr)?.year).toBe(2024);
    expect(worstYear(yr)?.return).toBeCloseTo(0.2, 10);
  });

  it('best/worstMonth ignore partial months', () => {
    const s = bars([
      ['2024-01-15', 100],
      ['2024-01-31', 105],
      ['2024-02-29', 100],
      ['2024-03-31', 110],
    ]);
    const mr = monthlyReturns(s);
    expect(bestMonth(mr)?.date).toBe('2024-03');
    expect(worstMonth(mr)?.date).toBe('2024-02');
  });
});

describe('pctPositiveMonths', () => {
  it('counts only full months', () => {
    const s = bars([
      ['2024-01-15', 100],
      ['2024-01-31', 110],
      ['2024-02-29', 105],
      ['2024-03-31', 116],
    ]);
    const mr = monthlyReturns(s);
    expect(pctPositiveMonths(mr)).toBeCloseTo(0.5, 10);
  });

  it('returns 0 when no full months exist', () => {
    const s = bars([
      ['2024-01-15', 100],
      ['2024-01-20', 110],
    ]);
    const mr = monthlyReturns(s);
    expect(pctPositiveMonths(mr)).toBe(0);
  });
});
