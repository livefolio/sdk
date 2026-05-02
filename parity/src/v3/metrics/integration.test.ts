import { describe, it, expect } from 'vitest';
import { runSimulation } from '../backtest/simulate';
import { SimulationHandle } from '../backtest/types';
import type { StrategyBar } from '../handles/strategy';
import { AllocationHandle } from '../handles/allocation';
import { PortfolioHandle } from '../handles/portfolio';
import { TickerHandle } from '../handles/ticker';

function stubAllocation(holdings: [{ symbol: string; leverage: number }, number][]): AllocationHandle {
  const tickerHoldings = holdings.map(
    ([t, w]) => [{ symbol: t.symbol, leverage: t.leverage } as TickerHandle, w] as [TickerHandle, number],
  );
  const handle = Object.create(AllocationHandle.prototype) as AllocationHandle;
  Object.defineProperty(handle, 'holdings', { value: tickerHoldings, writable: false });
  return handle;
}

function cashPortfolio(amount: number): PortfolioHandle {
  return new PortfolioHandle([[{ symbol: 'CASHX', leverage: 1 } as TickerHandle, amount]]);
}

/**
 * Thin wrapper: run the simulation engine and wrap the result in a
 * SimulationHandle so we can call .metrics() on it, mirroring what
 * StrategyHandle.simulate() does in production.
 */
function simulate(
  bars: StrategyBar[],
  prices: Record<string, Record<string, number>>,
  rebalanceDates: Set<string>,
  portfolio: PortfolioHandle,
): SimulationHandle {
  const result = runSimulation(bars, prices, rebalanceDates, portfolio);
  return new SimulationHandle(result.series, result.trades, portfolio);
}

describe('SimulationHandle.metrics() end-to-end', () => {
  it('produces a populated MetricsResult from runSimulation output', () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);

    // 12 monthly bars with SPY climbing 1% per period.
    const dates: string[] = [];
    const spyPrices: Record<string, number> = {};
    for (let i = 0; i < 12; i++) {
      const date = new Date(Date.UTC(2024, i, 28)).toISOString().slice(0, 10);
      dates.push(date);
      spyPrices[date] = 100 * Math.pow(1.01, i);
    }
    const bars: StrategyBar[] = dates.map((date) => ({ date, allocation: alloc }));
    const prices = { 'SPY:1': spyPrices };
    const rebalanceDates = new Set(dates);

    const sim = simulate(bars, prices, rebalanceDates, cashPortfolio(100_000));
    const result = sim.metrics();

    expect(result.range.from).toBe(sim.series[0]!.date);
    expect(result.range.to).toBe(sim.series[sim.series.length - 1]!.date);
    expect(result.returns.totalReturn).toBeGreaterThan(0);
    expect(result.activity.rebalances).toBeGreaterThan(0);
    expect(result.activity.trades).toBeGreaterThan(0);
    expect(typeof result.riskAdjusted.sharpe).toBe('number');
  });

  it('forwards options to computeMetrics', () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const dates = ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30'];
    const spyPrices: Record<string, number> = {
      '2024-01-31': 100,
      '2024-02-29': 90, // -10%
      '2024-03-31': 100,
      '2024-04-30': 110,
    };
    const bars: StrategyBar[] = dates.map((date) => ({ date, allocation: alloc }));
    const prices = { 'SPY:1': spyPrices };
    const rebalanceDates = new Set([dates[0]!]);

    const sim = simulate(bars, prices, rebalanceDates, cashPortfolio(100_000));
    const result = sim.metrics({ topDrawdowns: 1 });
    expect(result.tables.drawdowns.length).toBeLessThanOrEqual(1);
  });
});
