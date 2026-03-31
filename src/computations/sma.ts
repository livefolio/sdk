import type { DailyBar } from '../handles/indicator.js';

export function computeSma(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback) return [];
  const result: DailyBar[] = [];
  let sum = 0;
  for (let i = 0; i < lookback; i++) sum += bars[i].value;
  result.push({ date: bars[lookback - 1].date, value: sum / lookback });
  for (let i = lookback; i < bars.length; i++) {
    sum += bars[i].value - bars[i - lookback].value;
    result.push({ date: bars[i].date, value: sum / lookback });
  }
  return result;
}
