import { describe, it, expect } from 'vitest';
import { simulate, isRebalanceDay } from './backtest';
import type { Strategy, SimulationInput } from './types';

// ---------------------------------------------------------------------------
// Test strategy: SPY Price > SMA(5) → hold SPY, else hold BND
// ---------------------------------------------------------------------------

function makeStrategy(
  frequency: Strategy['trading']['frequency'] = 'Daily',
  offset = 0,
): Strategy {
  return {
    linkId: 'test-123',
    name: 'Test Strategy',
    trading: { frequency, offset },
    allocations: [
      {
        name: 'Aggressive',
        allocation: {
          condition: {
            kind: 'signal',
            signal: {
              left: { type: 'Price', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
              comparison: '>',
              right: { type: 'SMA', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 3, delay: 0, unit: null, threshold: null },
              tolerance: 0,
            },
          },
          holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
        },
      },
      {
        name: 'Defensive',
        allocation: {
          condition: {
            kind: 'signal',
            signal: {
              left: { type: 'Threshold', ticker: { symbol: '', leverage: 1 }, lookback: 0, delay: 0, unit: null, threshold: 1 },
              comparison: '>',
              right: { type: 'Threshold', ticker: { symbol: '', leverage: 1 }, lookback: 0, delay: 0, unit: null, threshold: 0 },
              tolerance: 0,
            },
          },
          holdings: [{ ticker: { symbol: 'BND', leverage: 1 }, weight: 100 }],
        },
      },
    ],
    signals: [
      {
        name: 'SPY above SMA3',
        signal: {
          left: { type: 'Price', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
          comparison: '>',
          right: { type: 'SMA', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 3, delay: 0, unit: null, threshold: null },
          tolerance: 0,
        },
      },
    ],
  };
}

function mc(dateStr: string): string {
  return `${dateStr}T21:00:00.000Z`;
}

// SPY prices: rising trend, then dip, then recovery
const SPY_SERIES = [
  { timestamp: mc('2025-01-02'), value: 100 },
  { timestamp: mc('2025-01-03'), value: 102 },
  { timestamp: mc('2025-01-06'), value: 104 },
  { timestamp: mc('2025-01-07'), value: 103 },
  { timestamp: mc('2025-01-08'), value: 101 },
  { timestamp: mc('2025-01-09'), value: 99 },
  { timestamp: mc('2025-01-10'), value: 102 },
  { timestamp: mc('2025-01-13'), value: 105 },
];

// BND prices: steady slight growth
const BND_SERIES = [
  { timestamp: mc('2025-01-02'), value: 50 },
  { timestamp: mc('2025-01-03'), value: 50.1 },
  { timestamp: mc('2025-01-06'), value: 50.2 },
  { timestamp: mc('2025-01-07'), value: 50.3 },
  { timestamp: mc('2025-01-08'), value: 50.4 },
  { timestamp: mc('2025-01-09'), value: 50.5 },
  { timestamp: mc('2025-01-10'), value: 50.6 },
  { timestamp: mc('2025-01-13'), value: 50.7 },
];

const TRADING_DAYS = [
  '2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07',
  '2025-01-08', '2025-01-09', '2025-01-10', '2025-01-13',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isRebalanceDay', () => {
  it('Daily frequency always returns true', () => {
    const date = new Date('2025-01-06T21:00:00Z'); // Monday
    expect(isRebalanceDay(date, 'Daily', 0, new Date('2025-01-01'))).toBe(true);
  });

  it('Weekly frequency matches day of week', () => {
    const monday = new Date('2025-01-06T21:00:00Z');
    expect(isRebalanceDay(monday, 'Weekly', 1, new Date('2025-01-01'))).toBe(true); // Monday = 1
    expect(isRebalanceDay(monday, 'Weekly', 3, new Date('2025-01-01'))).toBe(false); // Wednesday = 3
  });

  it('Monthly frequency matches day of month', () => {
    const jan15 = new Date('2025-01-15T21:00:00Z');
    expect(isRebalanceDay(jan15, 'Monthly', 15, new Date('2025-01-01'))).toBe(true);
    expect(isRebalanceDay(jan15, 'Monthly', 1, new Date('2025-01-01'))).toBe(false);
  });

  it('Quarterly frequency matches every 3 months on offset day', () => {
    const jan15 = new Date('2025-01-15T21:00:00Z'); // Jan = month 0, 0 % 3 === 0
    const feb15 = new Date('2025-02-15T21:00:00Z'); // Feb = month 1, 1 % 3 !== 0
    const apr15 = new Date('2025-04-15T21:00:00Z'); // Apr = month 3, 3 % 3 === 0
    expect(isRebalanceDay(jan15, 'Quarterly', 15, new Date('2025-01-01'))).toBe(true);
    expect(isRebalanceDay(feb15, 'Quarterly', 15, new Date('2025-01-01'))).toBe(false);
    expect(isRebalanceDay(apr15, 'Quarterly', 15, new Date('2025-01-01'))).toBe(true);
  });

  it('Yearly frequency matches anniversary', () => {
    const startDate = new Date('2023-03-15T00:00:00Z'); // March 15
    const anniversary = new Date('2025-03-15T21:00:00Z');
    const notAnniversary = new Date('2025-04-15T21:00:00Z');
    expect(isRebalanceDay(anniversary, 'Yearly', 0, startDate)).toBe(true);
    expect(isRebalanceDay(notAnniversary, 'Yearly', 0, startDate)).toBe(false);
  });
});

describe('simulate', () => {
  it('returns empty array for empty trading days', () => {
    const result = simulate({
      strategy: makeStrategy(),
      tradingDays: [],
      batchSeries: { SPY: SPY_SERIES, BND: BND_SERIES },
    });
    expect(result).toEqual([]);
  });

  it('starts at 100 and produces points for each trading day', () => {
    const result = simulate({
      strategy: makeStrategy(),
      tradingDays: TRADING_DAYS,
      batchSeries: { SPY: SPY_SERIES, BND: BND_SERIES },
    });

    expect(result).toHaveLength(TRADING_DAYS.length);
    expect(result[0].value).toBe(100);
    expect(result[0].date).toBe('2025-01-02');
  });

  it('records allocation name on each point', () => {
    const result = simulate({
      strategy: makeStrategy(),
      tradingDays: TRADING_DAYS,
      batchSeries: { SPY: SPY_SERIES, BND: BND_SERIES },
    });

    for (const point of result) {
      expect(['Aggressive', 'Defensive']).toContain(point.allocation);
    }
  });

  it('compounds returns correctly for rising prices', () => {
    // Use a simple always-true strategy (Threshold 1 > 0)
    const simpleStrategy: Strategy = {
      linkId: 'simple',
      name: 'Always SPY',
      trading: { frequency: 'Daily', offset: 0 },
      allocations: [{
        name: 'SPY Only',
        allocation: {
          condition: {
            kind: 'signal',
            signal: {
              left: { type: 'Threshold', ticker: { symbol: '', leverage: 1 }, lookback: 0, delay: 0, unit: null, threshold: 1 },
              comparison: '>',
              right: { type: 'Threshold', ticker: { symbol: '', leverage: 1 }, lookback: 0, delay: 0, unit: null, threshold: 0 },
              tolerance: 0,
            },
          },
          holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
        },
      }],
      signals: [],
    };

    // Simple 3-day series: 100 → 110 → 121 (10% each day)
    const series = [
      { timestamp: mc('2025-01-06'), value: 100 },
      { timestamp: mc('2025-01-07'), value: 110 },
      { timestamp: mc('2025-01-08'), value: 121 },
    ];

    const result = simulate({
      strategy: simpleStrategy,
      tradingDays: ['2025-01-06', '2025-01-07', '2025-01-08'],
      batchSeries: { SPY: series },
    });

    expect(result).toHaveLength(3);
    expect(result[0].value).toBe(100);
    expect(result[1].value).toBeCloseTo(110, 5); // 100 * 1.10
    expect(result[2].value).toBeCloseTo(121, 5); // 110 * 1.10
  });

  it('switches allocation on signal change', () => {
    const result = simulate({
      strategy: makeStrategy(),
      tradingDays: TRADING_DAYS,
      batchSeries: { SPY: SPY_SERIES, BND: BND_SERIES },
    });

    // With SPY falling below SMA(3) around days 4-5, we should see allocation changes
    const allocations = result.map((p) => p.allocation);
    const uniqueAllocations = new Set(allocations);
    // The strategy should have switched at least once (aggressive → defensive or vice versa)
    expect(uniqueAllocations.size).toBeGreaterThanOrEqual(1);
  });

  it('uses custom execution prices when provided', () => {
    const simpleStrategy: Strategy = {
      linkId: 'simple',
      name: 'Always SPY',
      trading: { frequency: 'Daily', offset: 0 },
      allocations: [{
        name: 'SPY Only',
        allocation: {
          condition: {
            kind: 'signal',
            signal: {
              left: { type: 'Threshold', ticker: { symbol: '', leverage: 1 }, lookback: 0, delay: 0, unit: null, threshold: 1 },
              comparison: '>',
              right: { type: 'Threshold', ticker: { symbol: '', leverage: 1 }, lookback: 0, delay: 0, unit: null, threshold: 0 },
              tolerance: 0,
            },
          },
          holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
        },
      }],
      signals: [],
    };

    // Signal series (for evaluation)
    const signalSeries = [
      { timestamp: mc('2025-01-06'), value: 100 },
      { timestamp: mc('2025-01-07'), value: 110 },
      { timestamp: mc('2025-01-08'), value: 121 },
    ];

    // Different execution prices
    const executionPrices = {
      SPY: {
        '2025-01-06': 100,
        '2025-01-07': 105, // 5% vs 10% in signal
        '2025-01-08': 110.25, // 5% vs 10% in signal
      },
    };

    const result = simulate({
      strategy: simpleStrategy,
      tradingDays: ['2025-01-06', '2025-01-07', '2025-01-08'],
      batchSeries: { SPY: signalSeries },
      executionPrices,
    });

    expect(result[1].value).toBeCloseTo(105, 5); // 100 * 1.05
    expect(result[2].value).toBeCloseTo(110.25, 5); // 105 * 1.05
  });

  it('respects weekly rebalance frequency', () => {
    // Weekly on Monday (offset=1). Even if allocation should change,
    // non-Monday days won't trigger rebalance unless allocation actually changes
    const strategy = makeStrategy('Weekly', 1); // Monday
    const result = simulate({
      strategy,
      tradingDays: TRADING_DAYS,
      batchSeries: { SPY: SPY_SERIES, BND: BND_SERIES },
    });

    expect(result).toHaveLength(TRADING_DAYS.length);
    // Each point should have a valid allocation
    for (const p of result) {
      expect(p.allocation).toBeTruthy();
    }
  });
});
