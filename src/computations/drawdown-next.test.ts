import { describe, it, expect } from 'vitest';
import { computeDrawdown, drawdownNext, drawdownInitialState } from './drawdown';
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

describe('drawdownNext / drawdownInitialState', () => {
  it('initialState returns null when bars.length < lookback', () => {
    expect(drawdownInitialState(synthetic(4), 5)).toBeNull();
  });

  it('initialState carries the last N raw values as tail', () => {
    const bars = synthetic(10);
    expect(drawdownInitialState(bars, 5)).toEqual({ tail: bars.slice(-5).map((b) => b.value) });
  });

  it('replaying drawdownNext from a checkpoint matches computeDrawdown', () => {
    const bars = synthetic(30, 17);
    const lookback = 5;
    const full = computeDrawdown(bars, lookback);
    let state = drawdownInitialState(bars.slice(0, lookback), lookback)!;
    const replay: number[] = [full[0]!.value];
    for (let i = lookback; i < bars.length; i++) {
      const { value, state: next } = drawdownNext(state, bars[i]!.value, lookback);
      replay.push(value);
      state = next;
    }
    expect(replay.length).toBe(full.length);
    for (let i = 0; i < full.length; i++) {
      expect(replay[i]).toBeCloseTo(full[i]!.value, 10);
    }
  });
});
