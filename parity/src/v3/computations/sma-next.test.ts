import { describe, it, expect } from 'vitest';
import { computeSma } from './sma';
import { smaNext, smaInitialState } from './sma';
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

describe('smaNext / smaInitialState', () => {
  it('initialState returns null when bars.length < lookback', () => {
    expect(smaInitialState([], 5)).toBeNull();
    expect(smaInitialState(synthetic(4), 5)).toBeNull();
  });

  it('initialState carries the last N raw values as tail', () => {
    const bars = synthetic(10);
    const state = smaInitialState(bars, 5);
    expect(state).toEqual({ tail: bars.slice(-5).map((b) => b.value) });
  });

  it('replaying smaNext from a checkpoint matches computeSma', () => {
    const bars = synthetic(40, 7);
    const lookback = 10;
    const full = computeSma(bars, lookback);
    // Checkpoint at index lookback - 1 of full (first emitted point) — corresponds
    // to raw bars[0..lookback-1]. State tail is the raw bars[0..lookback-1].values.
    let state = smaInitialState(bars.slice(0, lookback), lookback)!;
    const replay: number[] = [full[0]!.value];
    for (let i = lookback; i < bars.length; i++) {
      const { value, state: next } = smaNext(state, bars[i]!.value, lookback);
      replay.push(value);
      state = next;
    }
    expect(replay.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
    }
  });
});
