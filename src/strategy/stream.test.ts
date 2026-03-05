import { describe, it, expect } from 'vitest';
import { mergeObservations } from './stream';

// ---------------------------------------------------------------------------
// mergeObservations
// ---------------------------------------------------------------------------

describe('mergeObservations', () => {
  it('appends new-day observation to existing series', () => {
    const series = {
      SPY: [{ timestamp: '2025-01-09T21:00:00.000Z', value: 100 }],
    };
    const result = mergeObservations(series, [
      { symbol: 'SPY', timestamp: '2025-01-10T19:30:00.000Z', value: 110 },
    ]);
    expect(result.SPY).toHaveLength(2);
    expect(result.SPY[1].value).toBe(110);
  });

  it('replaces same-date entry', () => {
    const series = {
      SPY: [{ timestamp: '2025-01-10T21:00:00.000Z', value: 100 }],
    };
    const result = mergeObservations(series, [
      { symbol: 'SPY', timestamp: '2025-01-10T19:30:00.000Z', value: 200 },
    ]);
    expect(result.SPY).toHaveLength(1);
    expect(result.SPY[0].value).toBe(200);
  });

  it('creates new series for unknown symbol', () => {
    const result = mergeObservations({}, [
      { symbol: 'QQQ', timestamp: '2025-01-10T19:30:00.000Z', value: 50 },
    ]);
    expect(result.QQQ).toHaveLength(1);
    expect(result.QQQ[0].value).toBe(50);
  });

  it('handles multiple observations for different symbols', () => {
    const series = {
      SPY: [{ timestamp: '2025-01-09T21:00:00.000Z', value: 100 }],
    };
    const result = mergeObservations(series, [
      { symbol: 'SPY', timestamp: '2025-01-10T19:30:00.000Z', value: 110 },
      { symbol: 'BND', timestamp: '2025-01-10T19:30:00.000Z', value: 72 },
    ]);
    expect(result.SPY).toHaveLength(2);
    expect(result.BND).toHaveLength(1);
  });

  it('does not mutate the original series', () => {
    const original = {
      SPY: [{ timestamp: '2025-01-09T21:00:00.000Z', value: 100 }],
    };
    mergeObservations(original, [
      { symbol: 'SPY', timestamp: '2025-01-10T19:30:00.000Z', value: 110 },
    ]);
    expect(original.SPY).toHaveLength(1);
  });
});
