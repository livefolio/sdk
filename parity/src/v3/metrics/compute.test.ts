import { describe, it, expect } from 'vitest';
import { computeMetrics } from './compute';
import type { DailyBar } from '../handles/indicator';
import type { Trade } from '../backtest/types';

function buildSeries(): DailyBar[] {
  const out: DailyBar[] = [];
  let v = 100;
  for (let y = 2023; y <= 2024; y++) {
    for (let m = 0; m < 12; m++) {
      const last = new Date(Date.UTC(y, m + 1, 0));
      const dateStr = last.toISOString().slice(0, 10);
      v *= m % 2 === 0 ? 1.02 : 0.99;
      out.push({ date: dateStr, value: v });
    }
  }
  out.unshift({ date: '2023-01-01', value: 100 });
  return out;
}

describe('computeMetrics integration', () => {
  it('returns a fully shaped MetricsResult', () => {
    const series = buildSeries();
    const trades: Trade[] = [
      { date: '2023-06-30', symbol: 'SPY', quantity: 10, price: 100, action: 'buy' },
      { date: '2024-06-30', symbol: 'SPY', quantity: 10, price: 110, action: 'sell' },
    ];
    const result = computeMetrics(series, trades, { riskFreeRate: 0.04 });

    expect(result.range.from).toBe(series[0]!.date);
    expect(result.range.to).toBe(series[series.length - 1]!.date);
    expect(result.range.years).toBeGreaterThan(1.9);

    expect(typeof result.returns.totalReturn).toBe('number');
    expect(typeof result.returns.cagr).toBe('number');
    expect(typeof result.risk.volatility).toBe('number');
    expect(result.risk.maxDrawdown).toBeDefined();
    expect(typeof result.riskAdjusted.sharpe).toBe('number');

    expect(result.activity.rebalances).toBe(2);
    expect(result.activity.trades).toBe(2);

    expect(result.tables.monthly.rows.length).toBeGreaterThan(0);
    expect(result.tables.yearly.length).toBeGreaterThan(0);
    expect(Array.isArray(result.tables.drawdowns)).toBe(true);
  });

  it('throws on series.length < 2', () => {
    expect(() => computeMetrics([], [])).toThrow(/at least 2 daily bars/);
  });

  it('respects topDrawdowns option', () => {
    const series: DailyBar[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 95 },
      { date: '2024-01-03', value: 100 },
      { date: '2024-01-04', value: 90 },
      { date: '2024-01-05', value: 100 },
      { date: '2024-01-06', value: 80 },
      { date: '2024-01-07', value: 100 },
    ];
    expect(computeMetrics(series, [], { topDrawdowns: 1 }).tables.drawdowns).toHaveLength(1);
    expect(computeMetrics(series, [], { topDrawdowns: 5 }).tables.drawdowns).toHaveLength(3);
  });
});
