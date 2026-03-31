import { describe, it, expect } from 'vitest';
import { evaluateSignal } from './signal.js';
import type { DailyBar } from '../handles/indicator.js';

function bars(values: number[], startDate = '2025-01-01'): DailyBar[] {
  return values.map((value, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().split('T')[0], value };
  });
}

describe('evaluateSignal — no tolerance (raw comparison)', () => {
  it('> comparison', () => {
    const s1 = bars([10, 5, 15]);
    const s2 = bars([8, 8, 8]);
    const result = evaluateSignal(s1, s2, '>', 0, false);
    expect(result.map((r) => r.value)).toEqual([1, 0, 1]);
  });

  it('< comparison', () => {
    const s1 = bars([5, 10, 3]);
    const s2 = bars([8, 8, 8]);
    const result = evaluateSignal(s1, s2, '<', 0, false);
    expect(result.map((r) => r.value)).toEqual([1, 0, 1]);
  });

  it('= comparison with zero tolerance is exact match', () => {
    const s1 = bars([8, 5, 8]);
    const s2 = bars([8, 8, 8]);
    const result = evaluateSignal(s1, s2, '=', 0, false);
    expect(result.map((r) => r.value)).toEqual([1, 0, 1]);
  });
});

describe('evaluateSignal — relative tolerance with hysteresis', () => {
  it('> with 5% relative tolerance creates buffer zone', () => {
    const s1 = bars([103, 97, 94, 103, 106]);
    const s2 = bars([100, 100, 100, 100, 100]);
    const result = evaluateSignal(s1, s2, '>', 5, false);
    expect(result.map((r) => r.value)).toEqual([1, 1, 0, 0, 1]);
  });

  it('< with 5% relative tolerance', () => {
    const s1 = bars([97, 103, 106, 97, 94]);
    const s2 = bars([100, 100, 100, 100, 100]);
    const result = evaluateSignal(s1, s2, '<', 5, false);
    expect(result.map((r) => r.value)).toEqual([1, 1, 0, 0, 1]);
  });

  it('= with 5% relative tolerance creates a range', () => {
    const s1 = bars([100, 94, 106, 95, 105]);
    const s2 = bars([100, 100, 100, 100, 100]);
    const result = evaluateSignal(s1, s2, '=', 5, false);
    expect(result.map((r) => r.value)).toEqual([1, 0, 0, 1, 1]);
  });
});

describe('evaluateSignal — absolute tolerance with hysteresis', () => {
  it('> with absolute tolerance 2', () => {
    const s1 = bars([31, 29, 27, 31, 33]);
    const s2 = bars([30, 30, 30, 30, 30]);
    const result = evaluateSignal(s1, s2, '>', 2, true);
    expect(result.map((r) => r.value)).toEqual([1, 1, 0, 0, 1]);
  });
});

describe('evaluateSignal — previousValue for incremental', () => {
  it('continues hysteresis from previous value', () => {
    const s1 = bars([97, 94]);
    const s2 = bars([100, 100]);
    const result = evaluateSignal(s1, s2, '>', 5, false, 1);
    expect(result.map((r) => r.value)).toEqual([1, 0]);
  });

  it('without previousValue, first bar uses raw comparison', () => {
    const s1 = bars([97, 94]);
    const s2 = bars([100, 100]);
    const result = evaluateSignal(s1, s2, '>', 5, false);
    expect(result.map((r) => r.value)).toEqual([0, 0]);
  });
});

describe('evaluateSignal — edge cases', () => {
  it('empty series returns empty', () => {
    expect(evaluateSignal([], [], '>', 0, false)).toEqual([]);
  });

  it('mismatched dates are skipped (only aligned dates)', () => {
    const s1: DailyBar[] = [
      { date: '2025-01-01', value: 10 },
      { date: '2025-01-02', value: 20 },
      { date: '2025-01-03', value: 15 },
    ];
    const s2: DailyBar[] = [
      { date: '2025-01-01', value: 8 },
      { date: '2025-01-03', value: 8 },
    ];
    const result = evaluateSignal(s1, s2, '>', 0, false);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2025-01-01');
    expect(result[1].date).toBe('2025-01-03');
  });
});
