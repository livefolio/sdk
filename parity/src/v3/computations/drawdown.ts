import type { DailyBar } from '../handles/indicator';

export function computeDrawdown(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback) return [];
  const result: DailyBar[] = [];
  for (let i = lookback - 1; i < bars.length; i++) {
    let max = -Infinity;
    for (let j = i - lookback + 1; j <= i; j++) {
      if (bars[j]!.value > max) max = bars[j]!.value;
    }
    result.push({ date: bars[i]!.date, value: (bars[i]!.value - max) / max });
  }
  return result;
}

export interface DrawdownState {
  tail: number[];
}

export function drawdownInitialState(bars: DailyBar[], lookback: number): DrawdownState | null {
  if (bars.length < lookback) return null;
  return { tail: bars.slice(-lookback).map((b) => b.value) };
}

export function drawdownNext(
  prev: DrawdownState,
  newRaw: number,
  _lookback: number,
): { value: number; state: DrawdownState } {
  const tail = [...prev.tail.slice(1), newRaw];
  let max = -Infinity;
  for (const v of tail) if (v > max) max = v;
  return { value: (newRaw - max) / max, state: { tail } };
}
