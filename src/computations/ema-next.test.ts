import { describe, it, expect } from 'vitest';
import { computeEma, emaNext, emaInitialState } from './ema';
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

describe('emaNext / emaInitialState', () => {
  it('initialState returns null when bars.length < lookback', () => {
    expect(emaInitialState(synthetic(4), 5)).toBeNull();
  });

  it('initialState equals the last emitted ema value', () => {
    const bars = synthetic(12, 3);
    const full = computeEma(bars, 5);
    expect(emaInitialState(bars, 5)).toEqual({ ema: full[full.length - 1]!.value });
  });

  it('replaying emaNext from the seed checkpoint matches computeEma', () => {
    const bars = synthetic(40, 19);
    const lookback = 10;
    const full = computeEma(bars, lookback);
    // Seed at index lookback-1 of full (the first output). Its bar corresponds to
    // bars[lookback-1]. Start from the simple average of the first N bars.
    const seedSum = bars.slice(0, lookback).reduce((s, b) => s + b.value, 0);
    let state = { ema: seedSum / lookback };
    const replay: number[] = [state.ema];
    for (let i = lookback; i < bars.length; i++) {
      const { value, state: next } = emaNext(state, bars[i]!.value, lookback);
      replay.push(value);
      state = next;
    }
    expect(replay.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
    }
  });
});
