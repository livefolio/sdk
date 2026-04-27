import type { DailyBar } from '../handles/indicator';

export interface MonthlyReturn {
  year: number;
  month: number; // 0..11
  return: number;
  partial: boolean;
}

export interface YearlyReturn {
  year: number;
  return: number;
  partial: boolean;
}

export function dailyReturns(series: DailyBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!.value;
    const curr = series[i]!.value;
    out.push(curr / prev - 1);
  }
  return out;
}

function ymd(date: string): { y: number; m: number; d: number } {
  return {
    y: Number(date.slice(0, 4)),
    m: Number(date.slice(5, 7)) - 1,
    d: Number(date.slice(8, 10)),
  };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function monthlyReturns(series: DailyBar[]): MonthlyReturn[] {
  if (series.length < 2) return [];

  type Bucket = {
    year: number;
    month: number;
    firstDate: string;
    firstValue: number;
    lastDate: string;
    lastValue: number;
  };
  const buckets: Bucket[] = [];
  for (const bar of series) {
    const { y, m } = ymd(bar.date);
    const last = buckets[buckets.length - 1];
    if (!last || last.year !== y || last.month !== m) {
      buckets.push({
        year: y,
        month: m,
        firstDate: bar.date,
        firstValue: bar.value,
        lastDate: bar.date,
        lastValue: bar.value,
      });
    } else {
      last.lastDate = bar.date;
      last.lastValue = bar.value;
    }
  }

  const out: MonthlyReturn[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    const prevLast = i === 0 ? b.firstValue : buckets[i - 1]!.lastValue;
    const ret = b.lastValue / prevLast - 1;
    const startsAtMonthStart = ymd(b.firstDate).d === 1;
    const endsAtMonthEnd = ymd(b.lastDate).d === lastDayOfMonth(b.year, b.month);
    const isFirst = i === 0;
    const isLast = i === buckets.length - 1;
    const partial = (isFirst && !startsAtMonthStart) || (isLast && !endsAtMonthEnd);
    out.push({ year: b.year, month: b.month, return: ret, partial });
  }
  return out;
}

export function yearlyReturns(series: DailyBar[]): YearlyReturn[] {
  if (series.length < 2) return [];

  type Bucket = {
    year: number;
    firstDate: string;
    firstValue: number;
    lastDate: string;
    lastValue: number;
  };
  const buckets: Bucket[] = [];
  for (const bar of series) {
    const { y } = ymd(bar.date);
    const last = buckets[buckets.length - 1];
    if (!last || last.year !== y) {
      buckets.push({
        year: y,
        firstDate: bar.date,
        firstValue: bar.value,
        lastDate: bar.date,
        lastValue: bar.value,
      });
    } else {
      last.lastDate = bar.date;
      last.lastValue = bar.value;
    }
  }

  const out: YearlyReturn[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    const prevLast = i === 0 ? b.firstValue : buckets[i - 1]!.lastValue;
    const ret = b.lastValue / prevLast - 1;
    const isFirst = i === 0;
    const isLast = i === buckets.length - 1;
    const startsAtYearStart = b.firstDate.endsWith('-01-01');
    const endsAtYearEnd = b.lastDate.endsWith('-12-31');
    const partial = (isFirst && !startsAtYearStart) || (isLast && !endsAtYearEnd);
    out.push({ year: b.year, return: ret, partial });
  }
  return out;
}
