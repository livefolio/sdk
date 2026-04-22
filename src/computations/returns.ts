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

export interface ReturnState {
  tail: number[];
}

export function returnInitialState(bars: DailyBar[], lookback: number): ReturnState | null {
  if (bars.length < lookback + 1) return null;
  return { tail: bars.slice(-(lookback + 1)).map((b) => b.value) };
}

export function returnNext(
  prev: ReturnState,
  newRaw: number,
  lookback: number,
  mode: ReturnMode = 'pct',
): { value: number; state: ReturnState } {
  const tail = [...prev.tail.slice(1), newRaw];
  const old = tail[0]!;
  const value = mode === 'abs' ? newRaw - old : (newRaw - old) / old;
  return { value, state: { tail } };
}
