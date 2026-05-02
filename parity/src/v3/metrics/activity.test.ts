import { describe, it, expect } from 'vitest';
import { rebalanceCount, tradeCount, turnover, winRatePerRebalance } from './activity';
import type { Trade } from '../backtest/types';
import type { DailyBar } from '../handles/indicator';

const bars = (e: Array<[string, number]>): DailyBar[] => e.map(([date, value]) => ({ date, value }));

describe('rebalanceCount / tradeCount', () => {
  it('rebalanceCount = distinct trade dates', () => {
    const trades: Trade[] = [
      { date: '2024-01-02', symbol: 'SPY', quantity: 10, price: 100, action: 'buy' },
      { date: '2024-01-02', symbol: 'SHY', quantity: 5, price: 80, action: 'sell' },
      { date: '2024-02-01', symbol: 'SPY', quantity: 10, price: 110, action: 'sell' },
    ];
    expect(rebalanceCount(trades)).toBe(2);
    expect(tradeCount(trades)).toBe(3);
  });
});

describe('turnover', () => {
  it('excludes CASHX legs, normalizes by avg NAV, annualizes', () => {
    const trades: Trade[] = [
      { date: '2024-01-02', symbol: 'SPY', quantity: 10, price: 100, action: 'buy' }, // 1000
      { date: '2024-01-02', symbol: 'CASHX', quantity: 1000, price: 1, action: 'sell' }, // skipped
      { date: '2024-07-01', symbol: 'SPY', quantity: 5, price: 110, action: 'sell' }, // 550
    ];
    const series = bars([
      ['2024-01-02', 1000],
      ['2024-07-01', 1100],
      ['2024-12-31', 1200],
    ]);
    const avgNav = (1000 + 1100 + 1200) / 3;
    const expected = (1000 + 550) / avgNav / 1.0;
    expect(turnover(trades, series, 1.0)).toBeCloseTo(expected, 6);
  });

  it('returns 0 with no trades', () => {
    expect(
      turnover(
        [],
        bars([
          ['2024-01-01', 100],
          ['2024-12-31', 110],
        ]),
        1,
      ),
    ).toBe(0);
  });
});

describe('winRatePerRebalance', () => {
  it('NAV up across each segment → 1.0', () => {
    const series = bars([
      ['2024-01-01', 100],
      ['2024-04-01', 105],
      ['2024-07-01', 110],
      ['2024-12-31', 120],
    ]);
    const trades: Trade[] = [
      { date: '2024-04-01', symbol: 'SPY', quantity: 1, price: 100, action: 'buy' },
      { date: '2024-07-01', symbol: 'SPY', quantity: 1, price: 100, action: 'buy' },
    ];
    expect(winRatePerRebalance(series, trades)).toBe(1);
  });

  it('mixed segments produces fraction', () => {
    const series = bars([
      ['2024-01-01', 100],
      ['2024-04-01', 90],
      ['2024-07-01', 100],
      ['2024-12-31', 105],
    ]);
    const trades: Trade[] = [
      { date: '2024-04-01', symbol: 'SPY', quantity: 1, price: 100, action: 'buy' },
      { date: '2024-07-01', symbol: 'SPY', quantity: 1, price: 100, action: 'buy' },
    ];
    expect(winRatePerRebalance(series, trades)).toBeCloseTo(2 / 3, 10);
  });

  it('no trades → 1 if total return > 0, else 0', () => {
    expect(
      winRatePerRebalance(
        bars([
          ['2024-01-01', 100],
          ['2024-12-31', 110],
        ]),
        [],
      ),
    ).toBe(1);
    expect(
      winRatePerRebalance(
        bars([
          ['2024-01-01', 100],
          ['2024-12-31', 90],
        ]),
        [],
      ),
    ).toBe(0);
  });
});
