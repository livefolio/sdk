import type { DailyBar } from '../handles/indicator';

export function computeRsi(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback + 1) return [];
  const changes: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    changes.push(bars[i].value - bars[i - 1].value);
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < lookback; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= lookback;
  avgLoss /= lookback;
  const result: DailyBar[] = [];
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({
    date: bars[lookback].date,
    value: avgLoss === 0 ? 100 : 100 - 100 / (1 + rs),
  });
  for (let i = lookback; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (lookback - 1) + gain) / lookback;
    avgLoss = (avgLoss * (lookback - 1) + loss) / lookback;
    const smoothRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({
      date: bars[i + 1].date,
      value: avgLoss === 0 ? 100 : 100 - 100 / (1 + smoothRs),
    });
  }
  return result;
}

export interface RsiState {
  avgGain: number;
  avgLoss: number;
  prev: number;
}

export function rsiInitialState(bars: DailyBar[], lookback: number): RsiState | null {
  if (bars.length < lookback + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= lookback; i++) {
    const change = bars[i]!.value - bars[i - 1]!.value;
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= lookback;
  avgLoss /= lookback;
  let state: RsiState = { avgGain, avgLoss, prev: bars[lookback]!.value };
  for (let i = lookback + 1; i < bars.length; i++) {
    const { state: next } = rsiNext(state, bars[i]!.value, lookback);
    state = next;
  }
  return state;
}

export function rsiNext(prev: RsiState, newRaw: number, lookback: number): { value: number; state: RsiState } {
  const change = newRaw - prev.prev;
  const gain = change > 0 ? change : 0;
  const loss = change < 0 ? -change : 0;
  const avgGain = (prev.avgGain * (lookback - 1) + gain) / lookback;
  const avgLoss = (prev.avgLoss * (lookback - 1) + loss) / lookback;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const value = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  return { value, state: { avgGain, avgLoss, prev: newRaw } };
}
