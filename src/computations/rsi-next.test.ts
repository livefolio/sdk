import { describe, it, expect } from 'vitest';
import { computeRsi, rsiNext, rsiInitialState } from './rsi';
import type { DailyBar } from '../handles/indicator';

function synthetic(n: number, seed = 1): DailyBar[] {
  const bars: DailyBar[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    bars.push({
      date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 100 + (x % 10000) / 100,
    });
  }
  return bars;
}

describe('rsiNext / rsiInitialState', () => {
  it('initialState returns null when bars.length < lookback + 1', () => {
    expect(rsiInitialState(synthetic(5), 5)).toBeNull();
  });

  it('replaying rsiNext from the seed checkpoint matches computeRsi', () => {
    const bars = synthetic(40, 23);
    const lookback = 10;
    const full = computeRsi(bars, lookback);
    // Build the same seed as computeRsi uses at index lookback:
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= lookback; i++) {
      const change = bars[i]!.value - bars[i - 1]!.value;
      if (change > 0) avgGain += change;
      else avgLoss += -change;
    }
    avgGain /= lookback;
    avgLoss /= lookback;
    let state = { avgGain, avgLoss, prev: bars[lookback]!.value };

    const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const replay: number[] = [avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0)];
    for (let i = lookback + 1; i < bars.length; i++) {
      const { value, state: next } = rsiNext(state, bars[i]!.value, lookback);
      replay.push(value);
      state = next;
    }
    expect(replay.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
    }
  });

  it('initialState returns the terminal state of computeRsi', () => {
    const bars = synthetic(30, 29);
    const lookback = 5;
    const state = rsiInitialState(bars, lookback)!;
    // One more bar → rsiNext should produce the RSI that computeRsi would if we had that bar
    const extra = { date: '2030-01-01', value: bars[bars.length - 1]!.value * 1.01 };
    const fullExtended = computeRsi([...bars, extra], lookback);
    const { value } = rsiNext(state, extra.value, lookback);
    expect(value).toBeCloseTo(fullExtended[fullExtended.length - 1]!.value, 10);
  });
});
