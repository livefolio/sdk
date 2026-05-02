import type { DailyBar } from '../handles/indicator';

export function computeEma(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback) return [];
  const multiplier = 2 / (lookback + 1);
  const result: DailyBar[] = [];
  let sum = 0;
  for (let i = 0; i < lookback; i++) sum += bars[i]!.value;
  let ema = sum / lookback;
  result.push({ date: bars[lookback - 1]!.date, value: ema });
  for (let i = lookback; i < bars.length; i++) {
    ema = bars[i]!.value * multiplier + ema * (1 - multiplier);
    result.push({ date: bars[i]!.date, value: ema });
  }
  return result;
}

export interface EmaState {
  ema: number;
}

export function emaInitialState(bars: DailyBar[], lookback: number): EmaState | null {
  if (bars.length < lookback) return null;
  const series = computeEma(bars, lookback);
  if (series.length === 0) return null;
  return { ema: series[series.length - 1]!.value };
}

export function emaNext(prev: EmaState, newRaw: number, lookback: number): { value: number; state: EmaState } {
  const multiplier = 2 / (lookback + 1);
  const ema = newRaw * multiplier + prev.ema * (1 - multiplier);
  return { value: ema, state: { ema } };
}
