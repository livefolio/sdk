import type { DailyBar } from '../handles/indicator.js';

export function computeDrawdown(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback) return [];
  const result: DailyBar[] = [];
  for (let i = lookback - 1; i < bars.length; i++) {
    let max = -Infinity;
    for (let j = i - lookback + 1; j <= i; j++) {
      if (bars[j].value > max) max = bars[j].value;
    }
    result.push({ date: bars[i].date, value: (bars[i].value - max) / max });
  }
  return result;
}
