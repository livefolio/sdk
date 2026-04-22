import { describe, it, expect } from 'vitest';
import { computeVolatility, volatilityNext, volatilityInitialState } from './volatility';
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

describe('volatilityNext / volatilityInitialState', () => {
  it('initialState returns null when bars.length < lookback + 1', () => {
    expect(volatilityInitialState(synthetic(5), 5)).toBeNull();
  });

  it('initialState carries the last N+1 raw values as tail', () => {
    const bars = synthetic(10);
    const state = volatilityInitialState(bars, 5);
    expect(state).toEqual({ tail: bars.slice(-6).map((b) => b.value) });
  });

  it('replaying volatilityNext from a checkpoint matches computeVolatility', () => {
    const bars = synthetic(30, 13);
    const lookback = 5;
    const full = computeVolatility(bars, lookback);
    let state = volatilityInitialState(bars.slice(0, lookback + 1), lookback)!;
    const replay: number[] = [full[0]!.value];
    for (let i = lookback + 1; i < bars.length; i++) {
      const { value, state: next } = volatilityNext(state, bars[i]!.value, lookback);
      replay.push(value);
      state = next;
    }
    expect(replay.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
    }
  });
});
