import type { MonthlyReturnsTable } from './types';
import type { MonthlyReturn, YearlyReturn } from './returns';

export function buildMonthlyTable(monthly: MonthlyReturn[]): MonthlyReturnsTable {
  if (monthly.length === 0) return { rows: [] };

  const byYear = new Map<number, (number | null)[]>();
  for (const m of monthly) {
    let row = byYear.get(m.year);
    if (!row) {
      row = new Array(12).fill(null) as (number | null)[];
      byYear.set(m.year, row);
    }
    row[m.month] = m.return;
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const rows = years.map((year) => {
    const months = byYear.get(year)!;
    let ytd: number | null = null;
    for (const v of months) {
      if (v == null) continue;
      ytd = (ytd == null ? 1 : 1 + ytd) * (1 + v) - 1;
    }
    return { year, months, ytd };
  });
  return { rows };
}

export function buildYearlyList(yearly: YearlyReturn[]): Array<{ year: number; return: number }> {
  return yearly.map((y) => ({ year: y.year, return: y.return }));
}
