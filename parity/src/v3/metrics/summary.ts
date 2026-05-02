import type { DailyBar } from '../handles/indicator';
import type { MonthlyReturn, YearlyReturn } from './returns';

const DAY_MS = 24 * 60 * 60 * 1000;

function dateUTC(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

export function totalReturn(series: DailyBar[]): number {
  return series[series.length - 1]!.value / series[0]!.value - 1;
}

export function years(series: DailyBar[]): number {
  const first = dateUTC(series[0]!.date);
  const last = dateUTC(series[series.length - 1]!.date);
  return (last - first) / DAY_MS / 365.25;
}

export function cagr(series: DailyBar[]): number {
  const y = years(series);
  if (y <= 0) return 0;
  const ratio = series[series.length - 1]!.value / series[0]!.value;
  return Math.pow(ratio, 1 / y) - 1;
}

export function bestYear(yr: YearlyReturn[]): { year: number; return: number } | null {
  let best: YearlyReturn | null = null;
  for (const y of yr) {
    if (y.partial) continue;
    if (!best || y.return > best.return) best = y;
  }
  return best ? { year: best.year, return: best.return } : null;
}

export function worstYear(yr: YearlyReturn[]): { year: number; return: number } | null {
  let worst: YearlyReturn | null = null;
  for (const y of yr) {
    if (y.partial) continue;
    if (!worst || y.return < worst.return) worst = y;
  }
  return worst ? { year: worst.year, return: worst.return } : null;
}

function monthKey(m: MonthlyReturn): string {
  return `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
}

export function bestMonth(mr: MonthlyReturn[]): { date: string; return: number } | null {
  let best: MonthlyReturn | null = null;
  for (const m of mr) {
    if (m.partial) continue;
    if (!best || m.return > best.return) best = m;
  }
  return best ? { date: monthKey(best), return: best.return } : null;
}

export function worstMonth(mr: MonthlyReturn[]): { date: string; return: number } | null {
  let worst: MonthlyReturn | null = null;
  for (const m of mr) {
    if (m.partial) continue;
    if (!worst || m.return < worst.return) worst = m;
  }
  return worst ? { date: monthKey(worst), return: worst.return } : null;
}

export function pctPositiveMonths(mr: MonthlyReturn[]): number {
  let total = 0;
  let pos = 0;
  for (const m of mr) {
    if (m.partial) continue;
    total++;
    if (m.return > 0) pos++;
  }
  return total === 0 ? 0 : pos / total;
}
