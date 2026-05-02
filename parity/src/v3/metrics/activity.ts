import type { DailyBar } from '../handles/indicator';
import type { Trade } from '../backtest/types';

export function rebalanceCount(trades: Trade[]): number {
  const dates = new Set<string>();
  for (const t of trades) dates.add(t.date);
  return dates.size;
}

export function tradeCount(trades: Trade[]): number {
  return trades.length;
}

export function turnover(trades: Trade[], series: DailyBar[], years: number): number {
  if (years <= 0 || series.length === 0) return 0;
  let gross = 0;
  for (const t of trades) {
    if (t.symbol === 'CASHX') continue;
    gross += Math.abs(t.quantity * t.price);
  }
  let navSum = 0;
  for (const bar of series) navSum += bar.value;
  const avgNav = navSum / series.length;
  if (avgNav === 0) return 0;
  return gross / avgNav / years;
}

function navAtOrBefore(series: DailyBar[], date: string): number | null {
  let result: number | null = null;
  for (const bar of series) {
    if (bar.date <= date) result = bar.value;
    else break;
  }
  return result;
}

export function winRatePerRebalance(series: DailyBar[], trades: Trade[]): number {
  if (series.length < 2) return 0;
  const firstDate = series[0]!.date;
  const lastDate = series[series.length - 1]!.date;

  const distinctTradeDates = Array.from(new Set(trades.map((t) => t.date))).sort();
  const inRange = distinctTradeDates.filter((d) => d > firstDate && d < lastDate);

  if (inRange.length === 0) {
    const total = series[series.length - 1]!.value / series[0]!.value - 1;
    return total > 0 ? 1 : 0;
  }

  const boundaries = [firstDate, ...inRange, lastDate];
  let wins = 0;
  let total = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = navAtOrBefore(series, boundaries[i]!);
    const b = navAtOrBefore(series, boundaries[i + 1]!);
    if (a == null || b == null || a === 0) continue;
    total++;
    if (b / a - 1 > 0) wins++;
  }
  return total === 0 ? 0 : wins / total;
}
