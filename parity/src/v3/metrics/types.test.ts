import { describe, it, expect } from 'vitest';
import { computeMetrics } from './index';

describe('computeMetrics (skeleton)', () => {
  it('throws when given fewer than 2 bars', () => {
    expect(() => computeMetrics([], [])).toThrow(/at least 2 daily bars/);
    expect(() => computeMetrics([{ date: '2024-01-02', value: 100 }], [])).toThrow(/at least 2 daily bars/);
  });
});
