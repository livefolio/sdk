import type { DailyBar } from '../handles/indicator.js';

export function computeVolatility(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback + 1) return [];
  const dailyReturns: { date: string; value: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    dailyReturns.push({
      date: bars[i].date,
      value: bars[i].value / bars[i - 1].value - 1,
    });
  }
  if (dailyReturns.length < lookback) return [];
  const result: DailyBar[] = [];
  for (let i = lookback - 1; i < dailyReturns.length; i++) {
    const window = dailyReturns.slice(i - lookback + 1, i + 1);
    const mean = window.reduce((s, r) => s + r.value, 0) / lookback;
    const variance = window.reduce((s, r) => s + (r.value - mean) ** 2, 0) / lookback;
    result.push({ date: dailyReturns[i].date, value: Math.sqrt(variance) });
  }
  return result;
}
