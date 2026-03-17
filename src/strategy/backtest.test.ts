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

  it('requires at least one allocation', async () => {
    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [],
      allocations: [],
    };

    await expect(backtest(strategy, makeOptions())).rejects.toThrow(
      'Strategy must include at least one allocation.',
    );
  });

  it('supports custom fallback allocation name', async () => {
    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [],
      allocations: [
        {
          name: 'Cash Fallback',
          allocation: {
            condition: { kind: 'and', args: [] },
            holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
          },
        },
      ],
    };

    const result = await backtest(strategy, makeOptions());
    expect(result.timeseries.allocation).toEqual([
      'Cash Fallback',
      'Cash Fallback',
      'Cash Fallback',
      'Cash Fallback',
    ]);
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
    expect(result.annualTax).toEqual([]);
    const returns: number[] = [];
    for (let i = 1; i < result.timeseries.portfolio.length; i++) {
      const prev = result.timeseries.portfolio[i - 1];
      const curr = result.timeseries.portfolio[i];
      returns.push((curr - prev) / prev);
    }
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
    const expectedSharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;
    expect(result.summary.sharpeRatio).toBeCloseTo(expectedSharpe, 8);
    expect(result.summary.totalReturnPct).toBeCloseTo(-2, 8);
    expect(result.summary.maxDrawdownPct).toBeLessThanOrEqual(0);
    expect(result.summary.annualizedVolatilityPct).toBeGreaterThan(0);
    expect(result.summary.cagrPct).toBeLessThan(0);
  });

  it('returns finite summary metrics when initial capital is zero', async () => {
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
    const result = await backtest(strategy, {
      ...makeOptions(),
      initialCapital: 0,
    });

    expect(result.summary.initialValue).toBe(0);
    expect(result.summary.finalValue).toBe(0);
    expect(result.summary.totalReturnPct).toBe(0);
    expect(result.summary.cagrPct).toBe(0);
    expect(result.summary.annualizedVolatilityPct).toBe(0);
    expect(result.summary.maxDrawdownPct).toBe(0);
    expect(result.summary.sharpeRatio).toBe(0);
  });

  it('handles single-day windows with zeroed return metrics', async () => {
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
    const result = await backtest(strategy, {
      ...makeOptions(),
      startDate: '2024-01-02',
      endDate: '2024-01-02',
      tradingDays: [makeOptions().tradingDays![0]],
      batchSeries: {
        SPY: [{ timestamp: '2024-01-02T21:00:00.000Z', value: 100 }],
        BIL: [{ timestamp: '2024-01-02T21:00:00.000Z', value: 100 }],
      },
    });

    expect(result.timeseries.dates).toEqual(['2024-01-02']);
    expect(result.summary.totalReturnPct).toBe(0);
    expect(result.summary.cagrPct).toBe(0);
    expect(result.summary.annualizedVolatilityPct).toBe(0);
    expect(result.summary.sharpeRatio).toBe(0);
    expect(result.summary.maxDrawdownPct).toBe(0);
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

  it('supports calendar and drift rebalance modes', async () => {
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
            holdings: [
              { ticker: { symbol: 'SPY', leverage: 1 }, weight: 50 },
              { ticker: { symbol: 'BIL', leverage: 1 }, weight: 50 },
            ],
          },
        },
      ],
    };
    const options = makeOptions();
    options.batchSeries = {
      SPY: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 200 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 200 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 200 },
      ],
      BIL: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 100 },
      ],
    };

    const onChange = await backtest(strategy, {
      ...options,
      allocationRebalance: { Default: { mode: 'on_change' } },
    });
    const daily = await backtest(strategy, {
      ...options,
      allocationRebalance: { Default: { mode: 'calendar', frequency: 'Daily' } },
    });
    const drift20 = await backtest(strategy, {
      ...options,
      allocationRebalance: { Default: { mode: 'drift', driftPct: 20 } },
    });
    const drift10 = await backtest(strategy, {
      ...options,
      allocationRebalance: { Default: { mode: 'drift', driftPct: 10 } },
    });

    expect(onChange.summary.tradeCount).toBe(2);
    expect(daily.summary.tradeCount).toBeGreaterThan(onChange.summary.tradeCount);
    expect(drift20.summary.tradeCount).toBe(2);
    expect(drift10.summary.tradeCount).toBeGreaterThan(drift20.summary.tradeCount);

    const monthly = await backtest(strategy, {
      ...options,
      allocationRebalance: { Default: { mode: 'calendar', frequency: 'Monthly' } },
    });
    const yearly = await backtest(strategy, {
      ...options,
      allocationRebalance: { Default: { mode: 'calendar', frequency: 'Yearly' } },
    });
    expect(monthly.summary.tradeCount).toBe(2);
    expect(yearly.summary.tradeCount).toBe(2);
  });

  it('uses allocation-level rebalance config when present', async () => {
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
            holdings: [
              { ticker: { symbol: 'SPY', leverage: 1 }, weight: 50 },
              { ticker: { symbol: 'BIL', leverage: 1 }, weight: 50 },
            ],
            rebalance: { mode: 'calendar', frequency: 'Daily' },
          },
        },
      ],
    };
    const options = makeOptions();
    options.batchSeries = {
      SPY: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 200 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 200 },
      ],
      BIL: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 100 },
      ],
    };

    const result = await backtest(strategy, options);

    expect(result.summary.tradeCount).toBeGreaterThan(2);
  });

  it('starts at the earliest common ticker availability date', async () => {
    const signal = {
      left: { type: 'Price' as const, ticker: { symbol: 'QQQ', leverage: 1 }, lookback: 1, delay: 0, unit: '$' as const, threshold: null },
      comparison: '>' as const,
      right: { type: 'Threshold' as const, ticker: { symbol: '', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: 50 },
      tolerance: 0,
    };
    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [{ name: 'Gate', signal }],
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
    const options = makeOptions();
    options.batchSeries = {
      SPY: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 101 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 102 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 103 },
      ],
      BIL: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 100 },
      ],
      QQQ: [
        { timestamp: '2024-01-04T21:00:00.000Z', value: 55 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 56 },
      ],
    };

    const result = await backtest(strategy, options);
    expect(result.timeseries.dates).toEqual(['2024-01-04', '2024-01-05']);
  });

  it('fails when any required ticker has no data in selected range', async () => {
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
    const options = makeOptions();
    options.batchSeries = {
      SPY: [{ timestamp: '2024-01-10T21:00:00.000Z', value: 100 }],
      BIL: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 100 },
      ],
    };

    await expect(backtest(strategy, options)).rejects.toThrow(
      'No market data for symbol SPY in selected date range.',
    );
  });

  it('starts at later holding availability even when signals are earlier', async () => {
    const signal = {
      left: { type: 'Price' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: '$' as const, threshold: null },
      comparison: '>' as const,
      right: { type: 'Threshold' as const, ticker: { symbol: '', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: 0 },
      tolerance: 0,
    };
    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [{ name: 'AlwaysTrue', signal }],
      allocations: [
        {
          name: 'Risk On',
          allocation: {
            condition: { kind: 'signal', signal },
            holdings: [{ ticker: { symbol: 'QQQ', leverage: 1 }, weight: 100 }],
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
    const options = makeOptions();
    options.batchSeries = {
      SPY: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 10 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 11 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 12 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 13 },
      ],
      QQQ: [
        { timestamp: '2024-01-04T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 101 },
      ],
      BIL: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 100 },
      ],
    };
    const result = await backtest(strategy, options);
    expect(result.timeseries.dates).toEqual(['2024-01-04', '2024-01-05']);
  });

  it('ignores ticker symbol attached to threshold indicators', async () => {
    const signal = {
      left: { type: 'Price' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: '$' as const, threshold: null },
      comparison: '>' as const,
      right: { type: 'Threshold' as const, ticker: { symbol: 'SHOULD_NOT_BE_REQUIRED', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: 0 },
      tolerance: 0,
    };
    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [{ name: 'Gate', signal }],
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
    expect(result.summary.tradeCount).toBeGreaterThan(0);
  });

  it('fails when required symbols do not share an overlapping availability window', async () => {
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
            holdings: [
              { ticker: { symbol: 'SPY', leverage: 1 }, weight: 50 },
              { ticker: { symbol: 'QQQ', leverage: 1 }, weight: 50 },
            ],
          },
        },
      ],
    };
    const options = makeOptions();
    options.batchSeries = {
      SPY: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 101 },
      ],
      QQQ: [
        { timestamp: '2024-01-04T21:00:00.000Z', value: 200 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 201 },
      ],
      BIL: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 100 },
      ],
    };

    await expect(backtest(strategy, options)).rejects.toThrow(
      'No overlapping market-data window across required symbols.',
    );
  });

  it('computes lot-based realized gains in annual tax output', async () => {
    const signal = {
      left: { type: 'Price' as const, ticker: { symbol: 'QQQ', leverage: 1 }, lookback: 1, delay: 0, unit: '$' as const, threshold: null },
      comparison: '>' as const,
      right: { type: 'Threshold' as const, ticker: { symbol: '', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: 50 },
      tolerance: 0,
    };
    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [{ name: 'RiskOn', signal }],
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
            holdings: [
              { ticker: { symbol: 'SPY', leverage: 1 }, weight: 50 },
              { ticker: { symbol: 'BIL', leverage: 1 }, weight: 50 },
            ],
          },
        },
      ],
    };
    const options = makeOptions();
    options.batchSeries = {
      SPY: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 50 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 200 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 150 },
      ],
      QQQ: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 0 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 0 },
      ],
      BIL: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 100 },
      ],
    };
    const result = await backtest(strategy, options);
    const tax = result.annualTax.find((row) => row.year === 2024);
    expect(tax).toBeDefined();
    expect(tax!.shortTermRealizedGains).toBeCloseTo(75_000, 6);
  });

  it('defers loss with wash-sale replacement buys', async () => {
    const signal = {
      left: { type: 'Price' as const, ticker: { symbol: 'QQQ', leverage: 1 }, lookback: 1, delay: 0, unit: '$' as const, threshold: null },
      comparison: '>' as const,
      right: { type: 'Threshold' as const, ticker: { symbol: '', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: 50 },
      tolerance: 0,
    };
    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [{ name: 'RiskOn', signal }],
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
    const options = makeOptions();
    options.batchSeries = {
      SPY: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 50 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 50 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 50 },
      ],
      QQQ: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 0 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 100 },
      ],
      BIL: [
        { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-03T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-04T21:00:00.000Z', value: 100 },
        { timestamp: '2024-01-05T21:00:00.000Z', value: 100 },
      ],
    };

    const result = await backtest(strategy, options);
    const tax = result.annualTax.find((row) => row.year === 2024);
    expect(tax).toBeDefined();
    expect(tax!.shortTermRealizedGains).toBeCloseTo(0, 6);
    expect(tax!.longTermRealizedGains).toBeCloseTo(0, 6);
  });

  it('classifies gains as long-term when held for more than one year', async () => {
    const signal = {
      left: { type: 'Price' as const, ticker: { symbol: 'QQQ', leverage: 1 }, lookback: 1, delay: 0, unit: '$' as const, threshold: null },
      comparison: '>' as const,
      right: { type: 'Threshold' as const, ticker: { symbol: '', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: 50 },
      tolerance: 0,
    };
    const strategy: Strategy = {
      linkId: 'x',
      name: 'x',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [{ name: 'RiskOn', signal }],
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
    const result = await backtest(strategy, {
      startDate: '2024-01-02',
      endDate: '2025-01-03',
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
          date: '2025-01-03',
          open: '2025-01-03T14:30:00.000Z',
          close: '2025-01-03T21:00:00.000Z',
          extended_open: '2025-01-03T09:00:00.000Z',
          extended_close: '2025-01-03T22:00:00.000Z',
        },
      ],
      batchSeries: {
        SPY: [
          { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
          { timestamp: '2025-01-03T21:00:00.000Z', value: 120 },
        ],
        QQQ: [
          { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
          { timestamp: '2025-01-03T21:00:00.000Z', value: 0 },
        ],
        BIL: [
          { timestamp: '2024-01-02T21:00:00.000Z', value: 100 },
          { timestamp: '2025-01-03T21:00:00.000Z', value: 100 },
        ],
      },
    });

    const tax2025 = result.annualTax.find((row) => row.year === 2025);
    expect(tax2025).toBeDefined();
    expect(tax2025!.shortTermRealizedGains).toBeCloseTo(0, 6);
    expect(tax2025!.longTermRealizedGains).toBeCloseTo(20_000, 6);
  });
});
