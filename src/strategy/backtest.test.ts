import { describe, it, expect } from 'vitest';
import { backtest } from './backtest';
import type { BacktestOptions, Strategy } from './types';

describe('backtest', () => {
  function makeOptions(): BacktestOptions {
    return {
      startDate: '2024-01-02',
      endDate: '2024-01-05',
      initialCapital: 100_000,
      tradingDays: [
        {
          date: '2024-01-02',
          open: '2024-01-02T14:30:00.000Z',
          close: '2024-01-02T21:00:00.000Z',
          extended_open: '2024-01-02T09:00:00.000Z',
          extended_close: '2024-01-02T22:00:00.000Z',
        },
        {
          date: '2024-01-03',
          open: '2024-01-03T14:30:00.000Z',
          close: '2024-01-03T21:00:00.000Z',
          extended_open: '2024-01-03T09:00:00.000Z',
          extended_close: '2024-01-03T22:00:00.000Z',
        },
        {
          date: '2024-01-04',
          open: '2024-01-04T14:30:00.000Z',
          close: '2024-01-04T21:00:00.000Z',
          extended_open: '2024-01-04T09:00:00.000Z',
          extended_close: '2024-01-04T22:00:00.000Z',
        },
        {
          date: '2024-01-05',
          open: '2024-01-05T14:30:00.000Z',
          close: '2024-01-05T21:00:00.000Z',
          extended_open: '2024-01-05T09:00:00.000Z',
          extended_close: '2024-01-05T22:00:00.000Z',
        },
      ],
      batchSeries: {
        SPY: [
          { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
          { timestamp: '2024-01-03T21:00:00.000Z', value: 99 },
          { timestamp: '2024-01-04T21:00:00.000Z', value: 101 },
          { timestamp: '2024-01-05T21:00:00.000Z', value: 98 },
        ],
        BIL: [
          { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
          { timestamp: '2024-01-03T21:00:00.000Z', value: 100 },
          { timestamp: '2024-01-04T21:00:00.000Z', value: 100 },
          { timestamp: '2024-01-05T21:00:00.000Z', value: 100 },
        ],
      },
    };
  }

  it('requires an explicit Default allocation', async () => {
    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [],
      allocations: [
        {
          name: 'Risk On',
          allocation: {
            condition: { kind: 'and', args: [] },
            holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
          },
        },
      ],
    };

    await expect(backtest(strategy, makeOptions())).rejects.toThrow(
      'Strategy must include exactly one allocation named "Default".',
    );
  });

  it('uses default allocation and tracks portfolio values', async () => {
    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [],
      allocations: [
        {
          name: 'Default',
          allocation: {
            condition: { kind: 'and', args: [] },
            holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
          },
        },
      ],
    };

    const result = await backtest(strategy, makeOptions());

    expect(result.summary.initialValue).toBe(100_000);
    expect(result.summary.finalValue).toBeCloseTo(98_000, 5);
    expect(result.timeseries.dates).toEqual(['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']);
    expect(result.summary.tradeCount).toBe(1);
    expect(result.trades[0].ticker).toBe('SPY');
  });

  it('switches between signal allocation and default', async () => {
    const signal = {
      left: { type: 'Price' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: '$' as const, threshold: null },
      comparison: '>' as const,
      right: { type: 'SMA' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 2, delay: 0, unit: '$' as const, threshold: null },
      tolerance: 0,
    };

    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [{ name: 'Trend', signal }],
      allocations: [
        {
          name: 'Risk On',
          allocation: {
            condition: { kind: 'signal', signal },
            holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
          },
        },
        {
          name: 'Default',
          allocation: {
            condition: { kind: 'and', args: [] },
            holdings: [{ ticker: { symbol: 'BIL', leverage: 1 }, weight: 100 }],
          },
        },
      ],
    };

    const result = await backtest(strategy, makeOptions());

    expect(result.summary.tradeCount).toBe(5);
    expect(result.timeseries.allocation).toEqual(['Default', 'Default', 'Risk On', 'Default']);
    expect(result.trades.filter((trade) => trade.action === 'sell').length).toBeGreaterThan(0);
  });
});
