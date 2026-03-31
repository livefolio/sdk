import type { DailyBar } from '../handles/indicator.js';

export function computeReturns(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length <= lookback) return [];
  const result: DailyBar[] = [];
  for (let i = lookback; i < bars.length; i++) {
    result.push({
      date: bars[i].date,
      value: (bars[i].value - bars[i - lookback].value) / bars[i - lookback].value,
    });
  }
  return result;
}
