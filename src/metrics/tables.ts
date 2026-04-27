import type { MonthlyReturnsTable } from './types';
import type { MonthlyReturn } from './returns';

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

export function buildYearlyList(monthly: MonthlyReturn[]): Array<{ year: number; return: number }> {
  const byYear = new Map<number, number[]>();
  for (const m of monthly) {
    if (m.partial) continue;
    let arr = byYear.get(m.year);
    if (!arr) {
      arr = [];
      byYear.set(m.year, arr);
    }
    arr.push(m.return);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  return years.map((year) => {
    const months = byYear.get(year)!;
    let compounded = 1;
    for (const v of months) compounded *= 1 + v;
    return { year, return: compounded - 1 };
  });
}
