import { describe, it, expect } from 'vitest';
import { getNextComputation, getInitialStateFn } from './index';

describe('next computation dispatch', () => {
  it('returns step + seed for every stateful type', () => {
    for (const type of ['SMA', 'EMA', 'RSI', 'Return', 'Volatility', 'Drawdown']) {
      expect(getNextComputation(type)).toBeDefined();
      expect(getInitialStateFn(type)).toBeDefined();
    }
  });

  it('returns undefined for stateless types', () => {
    for (const type of ['Price', 'VIX', 'VIX3M', 'T3M', 'Month', 'Threshold']) {
      expect(getNextComputation(type)).toBeUndefined();
      expect(getInitialStateFn(type)).toBeUndefined();
    }
  });
});
