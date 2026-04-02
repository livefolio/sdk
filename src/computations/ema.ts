import type { DailyBar } from '../handles/indicator';

export function computeEma(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback) return [];
  const multiplier = 2 / (lookback + 1);
  const result: DailyBar[] = [];
  let sum = 0;
  for (let i = 0; i < lookback; i++) sum += bars[i].value;
  let ema = sum / lookback;
  result.push({ date: bars[lookback - 1].date, value: ema });
  for (let i = lookback; i < bars.length; i++) {
    ema = bars[i].value * multiplier + ema * (1 - multiplier);
    result.push({ date: bars[i].date, value: ema });
  }
  return result;
}
