import { describe, it, expect } from 'vitest';
import { buildMonthlyTable, buildYearlyList } from './tables';
import type { MonthlyReturn } from './returns';

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
  it('compounds only non-partial months per year', () => {
    const monthly: MonthlyReturn[] = [
      { year: 2023, month: 11, return: 0.05, partial: true }, // skipped
      { year: 2024, month: 0, return: 0.1, partial: false }, // kept
      { year: 2024, month: 1, return: -0.05, partial: false }, // kept
      { year: 2024, month: 2, return: 0.02, partial: false }, // kept
    ];
    const list = buildYearlyList(monthly);
    expect(list).toHaveLength(1);
    expect(list[0]!.year).toBe(2024);
    expect(list[0]!.return).toBeCloseTo(1.1 * 0.95 * 1.02 - 1, 10);
  });

  it('separates years and excludes years with no full months', () => {
    const monthly: MonthlyReturn[] = [
      { year: 2023, month: 11, return: 0.01, partial: false },
      { year: 2024, month: 0, return: 0.02, partial: false },
      { year: 2025, month: 5, return: 0.03, partial: true }, // skipped → no 2025 row
    ];
    const list = buildYearlyList(monthly);
    expect(list.map((r) => r.year)).toEqual([2023, 2024]);
  });
});
