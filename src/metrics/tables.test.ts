import { describe, it, expect } from 'vitest';
import { buildMonthlyTable, buildYearlyList } from './tables';
import type { MonthlyReturn, YearlyReturn } from './returns';

describe('buildMonthlyTable', () => {
  it('places returns in month slots, nulls elsewhere, computes YTD', () => {
    const monthly: MonthlyReturn[] = [
      { year: 2024, month: 0, return: 0.1, partial: false },
      { year: 2024, month: 1, return: -0.05, partial: false },
      { year: 2024, month: 2, return: 0.02, partial: false },
    ];
    const table = buildMonthlyTable(monthly);
    expect(table.rows).toHaveLength(1);
    const row = table.rows[0]!;
    expect(row.year).toBe(2024);
    expect(row.months[0]).toBeCloseTo(0.1, 10);
    expect(row.months[1]).toBeCloseTo(-0.05, 10);
    expect(row.months[2]).toBeCloseTo(0.02, 10);
    expect(row.months[3]).toBeNull();
    expect(row.ytd).toBeCloseTo(1.1 * 0.95 * 1.02 - 1, 10);
  });

  it('separates years, keeps row order ascending', () => {
    const monthly: MonthlyReturn[] = [
      { year: 2023, month: 11, return: 0.05, partial: true },
      { year: 2024, month: 0, return: 0.03, partial: false },
    ];
    const table = buildMonthlyTable(monthly);
    expect(table.rows.map((r) => r.year)).toEqual([2023, 2024]);
  });
});

describe('buildYearlyList', () => {
  it('returns all years including partial', () => {
    const yearly: YearlyReturn[] = [
      { year: 2023, return: 0.1, partial: true },
      { year: 2024, return: 0.2, partial: false },
    ];
    expect(buildYearlyList(yearly)).toEqual([
      { year: 2023, return: 0.1 },
      { year: 2024, return: 0.2 },
    ]);
  });
});
