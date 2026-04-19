import type { DailyBar } from '../handles/indicator';

export type ReturnMode = 'pct' | 'abs';

export function computeReturns(bars: DailyBar[], lookback: number, mode: ReturnMode = 'pct'): DailyBar[] {
  if (bars.length <= lookback) return [];
  const result: DailyBar[] = [];
  for (let i = lookback; i < bars.length; i++) {
    const curr = bars[i]!.value;
    const prev = bars[i - lookback]!.value;
    const value = mode === 'abs' ? curr - prev : (curr - prev) / prev;
    result.push({ date: bars[i]!.date, value });
  }
  return result;
}
