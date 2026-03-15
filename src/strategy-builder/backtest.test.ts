import { describe, expect, it, vi } from 'vitest';
import { runDraftBacktest } from './backtest';
import type { StrategyDraft } from './types';

function makeDraft(): StrategyDraft {
  return {
    name: 'Custom Strategy',
    trading: { frequency: 'Daily', offset: 0 },
    signals: [
      {
        name: 'Signal 1',
        comparison: '>',
        tolerance: 0,
        left: { type: 'VIX', ticker: '', lookback: 1, delay: 0, threshold: null },
        right: { type: 'Threshold', ticker: '', lookback: 1, delay: 0, threshold: 20 },
      },
    ],
    allocations: [
      {
        name: 'Risk On',
        groups: [[{ signalName: 'Signal 1', not: false }]],
        holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
        rebalance: { mode: 'drift', driftPct: 5 },
      },
      {
        name: 'Default',
        groups: [],
        holdings: [{ ticker: { symbol: 'BIL', leverage: 1 }, weight: 100 }],
        rebalance: { mode: 'on_change' },
      },
    ],
  };
}

describe('runDraftBacktest', () => {
  it('compiles the draft, fetches buffered market data, and maps the SDK response', async () => {
    const getBatchSeriesFromDb = vi.fn().mockResolvedValue({
      '^VIX': [
        { timestamp: '2025-12-01T21:00:00.000Z', value: 30 },
        { timestamp: '2026-01-02T21:00:00.000Z', value: 30 },
      ],
      SPY: [{ timestamp: '2026-01-02T21:00:00.000Z', value: 600 }],
      BIL: [{ timestamp: '2026-01-02T21:00:00.000Z', value: 100 }],
    });
    const getTradingDays = vi.fn().mockResolvedValue([
      {
        date: '2026-01-02',
        open: '2026-01-02T14:30:00.000Z',
        close: '2026-01-02T21:00:00.000Z',
        extended_open: '2026-01-02T09:00:00.000Z',
        extended_close: '2026-01-03T01:00:00.000Z',
      },
    ]);

    const result = await runDraftBacktest(
      { getBatchSeriesFromDb, getTradingDays },
      makeDraft(),
      { startDate: '2026-01-02', endDate: '2026-01-02', initialCapital: 100000 },
    );

    expect(getTradingDays).toHaveBeenCalledWith('2026-01-02', '2026-01-02');
    expect(getBatchSeriesFromDb).toHaveBeenCalledWith(['^VIX', 'SPY', 'BIL'], '2025-12-01', '2026-01-02');
    expect(result.strategy.name).toBe('Custom Strategy');
    expect(result.summary.tradeCount).toBe(1);
    expect(result.timeseries.portfolio).toEqual([100000]);
    expect(result.trades[0]).toEqual({
      date: '2026-01-02',
      ticker: 'SPY',
      shares: 166.66666666666666,
      price: 600,
      value: 100000,
      action: 'buy',
      allocation: 'Risk On',
    });
  });
});
