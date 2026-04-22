import type { DailyBar } from '../handles/indicator';

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

export interface SmaState {
  tail: number[];
}

export function smaInitialState(bars: DailyBar[], lookback: number): SmaState | null {
  if (bars.length < lookback) return null;
  return { tail: bars.slice(-lookback).map((b) => b.value) };
}

export function smaNext(prev: SmaState, newRaw: number, lookback: number): { value: number; state: SmaState } {
  const tail = [...prev.tail.slice(1), newRaw];
  const sum = tail.reduce((a, b) => a + b, 0);
  return { value: sum / lookback, state: { tail } };
}
