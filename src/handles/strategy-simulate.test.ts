import { describe, it, expect, vi } from 'vitest';
import { StrategyHandle } from './strategy.js';
import { AllocationHandle } from './allocation.js';
import { TickerHandle } from './ticker.js';
import { PortfolioHandle } from './portfolio.js';
import type { StrategyBar } from './strategy.js';
import type { DailyBar } from './indicator.js';

function stubAllocation(holdings: [{ symbol: string; leverage: number }, number][]): AllocationHandle {
  const tickerHoldings = holdings.map(
    ([t, w]) => [{ symbol: t.symbol, leverage: t.leverage } as TickerHandle, w] as [TickerHandle, number],
  );
  const handle = Object.create(AllocationHandle.prototype) as AllocationHandle;
  Object.defineProperty(handle, 'holdings', { value: tickerHoldings, writable: false });
  return handle;
}

describe('StrategyHandle.simulate', () => {
  it('returns SimulationHandle with series and trades', async () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);

    const bars: StrategyBar[] = [
      { date: '2025-01-06', allocation: alloc },
      { date: '2025-01-07', allocation: alloc },
      { date: '2025-01-08', allocation: alloc },
    ];

    const priceBars: DailyBar[] = [
      { date: '2025-01-06', value: 500 },
      { date: '2025-01-07', value: 510 },
      { date: '2025-01-08', value: 505 },
    ];

    const supabase = {} as ConstructorParameters<typeof StrategyHandle>[0];
    const strategy = new StrategyHandle(supabase, {
      name: 'Test',
      freq: 'Daily',
      rules: [{ hold: alloc }],
    });

    vi.spyOn(strategy, 'series').mockResolvedValue(bars);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(strategy as any, '_fetchPricesForTickers').mockResolvedValue({
      SPY: Object.fromEntries(priceBars.map((b) => [b.date, b.value])),
    });

    const cashx = { symbol: 'CASHX', leverage: 1 } as TickerHandle;
    const portfolio = new PortfolioHandle([[cashx, 100_000]]);
    const sim = await strategy.simulate({ from: '2025-01-06', to: '2025-01-08', portfolio });

    expect(sim.series).toHaveLength(3);
    expect(sim.series[0]).toEqual({ date: '2025-01-06', value: 100_000 });
    expect(sim.series[1]).toEqual({ date: '2025-01-07', value: 102_000 });
    expect(sim.trades.length).toBeGreaterThan(0);
    expect(sim.startingPortfolio).toBe(portfolio);
  });

  it('respects custom portfolio', async () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const bars: StrategyBar[] = [{ date: '2025-01-06', allocation: alloc }];
    const supabase = {} as ConstructorParameters<typeof StrategyHandle>[0];
    const strategy = new StrategyHandle(supabase, {
      name: 'Test',
      freq: 'Daily',
      rules: [{ hold: alloc }],
    });

    vi.spyOn(strategy, 'series').mockResolvedValue(bars);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(strategy as any, '_fetchPricesForTickers').mockResolvedValue({
      SPY: { '2025-01-06': 500 },
    });

    const cashx = { symbol: 'CASHX', leverage: 1 } as TickerHandle;
    const portfolio = new PortfolioHandle([[cashx, 50_000]]);
    const sim = await strategy.simulate({ from: '2025-01-06', to: '2025-01-06', portfolio });

    expect(sim.startingPortfolio).toBe(portfolio);
    expect(sim.series[0].value).toBeCloseTo(50_000, 2);
  });

  it('returns empty SimulationHandle when no bars', async () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const supabase = {} as ConstructorParameters<typeof StrategyHandle>[0];
    const strategy = new StrategyHandle(supabase, {
      name: 'Test',
      freq: 'Daily',
      rules: [{ hold: alloc }],
    });

    vi.spyOn(strategy, 'series').mockResolvedValue([]);

    const cashx = { symbol: 'CASHX', leverage: 1 } as TickerHandle;
    const portfolio = new PortfolioHandle([[cashx, 100_000]]);
    const sim = await strategy.simulate({ from: '2025-01-06', to: '2025-01-08', portfolio });

    expect(sim.series).toHaveLength(0);
    expect(sim.trades).toHaveLength(0);
    expect(sim.startingPortfolio).toBe(portfolio);
  });
});
