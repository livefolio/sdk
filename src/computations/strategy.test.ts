import { describe, it, expect } from 'vitest';
import { computeRebalanceDates, evaluateStrategy } from './strategy.js';

describe('computeRebalanceDates', () => {
  it('Daily returns all trading days', () => {
    const days = ['2025-01-06', '2025-01-07', '2025-01-08'];
    expect(computeRebalanceDates(days, 'Daily', 0)).toEqual(new Set(days));
  });

  it('Weekly returns last trading day of each ISO week', () => {
    const days = [
      '2025-01-06',
      '2025-01-07',
      '2025-01-08',
      '2025-01-09',
      '2025-01-10',
      '2025-01-13',
      '2025-01-14',
      '2025-01-15',
      '2025-01-16',
      '2025-01-17',
    ];
    expect(computeRebalanceDates(days, 'Weekly', 0)).toEqual(new Set(['2025-01-10', '2025-01-17']));
  });

  it('Monthly returns last trading day of each month', () => {
    const days = ['2025-01-29', '2025-01-30', '2025-01-31', '2025-02-26', '2025-02-27', '2025-02-28'];
    expect(computeRebalanceDates(days, 'Monthly', 0)).toEqual(new Set(['2025-01-31', '2025-02-28']));
  });

  it('positive offset shifts earlier', () => {
    const days = ['2025-01-29', '2025-01-30', '2025-01-31', '2025-02-26', '2025-02-27', '2025-02-28'];
    expect(computeRebalanceDates(days, 'Monthly', 1)).toEqual(new Set(['2025-01-30', '2025-02-27']));
  });

  it('negative offset shifts later', () => {
    const days = [
      '2025-01-29',
      '2025-01-30',
      '2025-01-31',
      '2025-02-03',
      '2025-02-04',
      '2025-02-26',
      '2025-02-27',
      '2025-02-28',
    ];
    expect(computeRebalanceDates(days, 'Monthly', -1)).toEqual(new Set(['2025-02-03']));
  });

  it('Quarterly returns last trading day of each quarter', () => {
    const days = ['2025-03-28', '2025-03-31', '2025-06-27', '2025-06-30'];
    expect(computeRebalanceDates(days, 'Quarterly', 0)).toEqual(new Set(['2025-03-31', '2025-06-30']));
  });

  it('Yearly returns last trading day of each year', () => {
    const days = ['2024-12-30', '2024-12-31', '2025-12-30', '2025-12-31'];
    expect(computeRebalanceDates(days, 'Yearly', 0)).toEqual(new Set(['2024-12-31', '2025-12-31']));
  });
});

describe('evaluateStrategy', () => {
  it('evaluates rules on rebalance dates', () => {
    const signals = new Map([
      [
        1,
        new Map([
          ['2025-01-06', true],
          ['2025-01-07', false],
          ['2025-01-08', true],
        ]),
      ],
    ]);
    const rules = [
      { signalIds: [1], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const rebalance = new Set(['2025-01-06', '2025-01-07', '2025-01-08']);
    const days = ['2025-01-06', '2025-01-07', '2025-01-08'];

    const result = evaluateStrategy(signals, rules, rebalance, days);

    expect(result.get('2025-01-06')).toBe(0);
    expect(result.get('2025-01-07')).toBe(1);
    expect(result.get('2025-01-08')).toBe(0);
  });

  it('carries forward between rebalance dates', () => {
    const signals = new Map([[1, new Map([['2025-01-06', true]])]]);
    const rules = [
      { signalIds: [1], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const rebalance = new Set(['2025-01-06']);
    const days = ['2025-01-06', '2025-01-07', '2025-01-08'];

    const result = evaluateStrategy(signals, rules, rebalance, days);

    expect(result.get('2025-01-06')).toBe(0);
    expect(result.get('2025-01-07')).toBe(0);
    expect(result.get('2025-01-08')).toBe(0);
  });

  it('skips trading days before first rebalance', () => {
    const signals = new Map([[1, new Map([['2025-01-08', true]])]]);
    const rules = [
      { signalIds: [1], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const rebalance = new Set(['2025-01-08']);
    const days = ['2025-01-06', '2025-01-07', '2025-01-08'];

    const result = evaluateStrategy(signals, rules, rebalance, days);

    expect(result.has('2025-01-06')).toBe(false);
    expect(result.has('2025-01-07')).toBe(false);
    expect(result.get('2025-01-08')).toBe(0);
  });

  it('ANDs multiple signals in a rule', () => {
    const signals = new Map([
      [1, new Map([['2025-01-06', true]])],
      [2, new Map([['2025-01-06', false]])],
    ]);
    const rules = [
      { signalIds: [1, 2], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const result = evaluateStrategy(signals, rules, new Set(['2025-01-06']), ['2025-01-06']);

    expect(result.get('2025-01-06')).toBe(1);
  });

  it('OR via duplicate rules pointing to same allocation', () => {
    const signals = new Map([
      [
        1,
        new Map([
          ['2025-01-06', false],
          ['2025-01-07', true],
        ]),
      ],
      [
        2,
        new Map([
          ['2025-01-06', true],
          ['2025-01-07', false],
        ]),
      ],
    ]);
    const rules = [
      { signalIds: [1], allocationIndex: 0 },
      { signalIds: [2], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const days = ['2025-01-06', '2025-01-07'];
    const result = evaluateStrategy(signals, rules, new Set(days), days);

    expect(result.get('2025-01-06')).toBe(0);
    expect(result.get('2025-01-07')).toBe(0);
  });

  it('treats missing signal data as false', () => {
    const signals = new Map([[1, new Map<string, boolean>()]]);
    const rules = [
      { signalIds: [1], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const result = evaluateStrategy(signals, rules, new Set(['2025-01-06']), ['2025-01-06']);

    expect(result.get('2025-01-06')).toBe(1);
  });
});
