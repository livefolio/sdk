import { describe, it, expect } from 'vitest';
import { runSimulation } from './simulate';
import type { StrategyBar } from '../handles/strategy';
import { AllocationHandle } from '../handles/allocation';
import { TickerHandle } from '../handles/ticker';
import { PortfolioHandle } from '../handles/portfolio';

// Minimal stubs — we only read .holdings, .symbol, .leverage (synchronous properties)
function stubAllocation(holdings: [{ symbol: string; leverage: number }, number][]): AllocationHandle {
  const tickerHoldings = holdings.map(
    ([t, w]) => [{ symbol: t.symbol, leverage: t.leverage } as TickerHandle, w] as [TickerHandle, number],
  );
  // Use Object.create to avoid constructor validation needing supabase
  const handle = Object.create(AllocationHandle.prototype) as AllocationHandle;
  Object.defineProperty(handle, 'holdings', { value: tickerHoldings, writable: false });
  return handle;
}

function makeBars(dates: string[], allocation: AllocationHandle): StrategyBar[] {
  return dates.map((date) => ({ date, allocation }));
}

function stubPortfolio(holdings: [{ symbol: string; leverage: number }, number][]): PortfolioHandle {
  const tickerHoldings = holdings.map(
    ([t, qty]) => [{ symbol: t.symbol, leverage: t.leverage } as TickerHandle, qty] as [TickerHandle, number],
  );
  return new PortfolioHandle(tickerHoldings);
}

function cashPortfolio(amount: number): PortfolioHandle {
  return stubPortfolio([[{ symbol: 'CASHX', leverage: 1 }, amount]]);
}

describe('runSimulation', () => {
  it('invests on first rebalance day and tracks equity', () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06', '2025-01-07', '2025-01-08'], alloc);

    const prices = {
      SPY: {
        '2025-01-06': 500,
        '2025-01-07': 510,
        '2025-01-08': 505,
      },
    };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    // Day 1: buy 200 shares @ 500 = $100,000
    expect(result.series).toHaveLength(3);
    expect(result.series[0]).toEqual({ date: '2025-01-06', value: 100_000 });
    // Day 2: 200 shares @ 510 = $102,000
    expect(result.series[1]).toEqual({ date: '2025-01-07', value: 102_000 });
    // Day 3: 200 shares @ 505 = $101,000
    expect(result.series[2]).toEqual({ date: '2025-01-08', value: 101_000 });
  });

  it('generates buy trade on initial investment', () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06'], alloc);
    const prices = { SPY: { '2025-01-06': 500 } };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toEqual({
      date: '2025-01-06',
      symbol: 'SPY',
      quantity: 200,
      price: 500,
      action: 'buy',
    });
  });

  it('rebalances multi-ticker allocation on rebalance dates', () => {
    const alloc = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 0.6],
      [{ symbol: 'TLT', leverage: 1 }, 0.4],
    ]);
    const dates = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'];
    const bars = makeBars(dates, alloc);

    const prices = {
      SPY: {
        '2025-01-06': 500,
        '2025-01-07': 520,
        '2025-01-08': 520,
        '2025-01-09': 520,
        '2025-01-10': 520,
      },
      TLT: {
        '2025-01-06': 100,
        '2025-01-07': 100,
        '2025-01-08': 100,
        '2025-01-09': 100,
        '2025-01-10': 100,
      },
    };
    const rebalanceDates = new Set(['2025-01-06', '2025-01-08']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    expect(result.series[0].value).toBeCloseTo(100_000, 2);
    expect(result.series[1].value).toBeCloseTo(102_400, 2);
    expect(result.series[2].value).toBeCloseTo(102_400, 2);

    const day1Trades = result.trades.filter((t) => t.date === '2025-01-06');
    expect(day1Trades).toHaveLength(2);

    const day3Trades = result.trades.filter((t) => t.date === '2025-01-08');
    expect(day3Trades.length).toBeGreaterThan(0);
    const spySell = day3Trades.find((t) => t.symbol === 'SPY');
    expect(spySell?.action).toBe('sell');
    const tltBuy = day3Trades.find((t) => t.symbol === 'TLT');
    expect(tltBuy?.action).toBe('buy');
  });

  it('switches allocations on rebalance dates', () => {
    const aggressive = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const defensive = stubAllocation([[{ symbol: 'SHY', leverage: 1 }, 1.0]]);

    const bars: StrategyBar[] = [
      { date: '2025-01-06', allocation: aggressive },
      { date: '2025-01-07', allocation: aggressive },
      { date: '2025-01-08', allocation: defensive },
    ];

    const prices = {
      SPY: {
        '2025-01-06': 500,
        '2025-01-07': 510,
        '2025-01-08': 505,
      },
      SHY: {
        '2025-01-06': 80,
        '2025-01-07': 80,
        '2025-01-08': 80,
      },
    };
    const rebalanceDates = new Set(['2025-01-06', '2025-01-08']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    expect(result.series[0].value).toBeCloseTo(100_000, 2);
    expect(result.series[1].value).toBeCloseTo(102_000, 2);
    expect(result.series[2].value).toBeCloseTo(101_000, 2);

    const day3Trades = result.trades.filter((t) => t.date === '2025-01-08');
    expect(day3Trades).toHaveLength(2);
    expect(day3Trades.find((t) => t.symbol === 'SPY')?.action).toBe('sell');
    expect(day3Trades.find((t) => t.symbol === 'SHY')?.action).toBe('buy');
  });

  it('holds cash before first rebalance date', () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06', '2025-01-07', '2025-01-08'], alloc);
    const prices = {
      SPY: { '2025-01-06': 500, '2025-01-07': 510, '2025-01-08': 505 },
    };
    const rebalanceDates = new Set(['2025-01-07']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    expect(result.series[0].value).toBeCloseTo(100_000, 2);
    expect(result.trades.filter((t) => t.date === '2025-01-06')).toHaveLength(0);
    expect(result.series[1].value).toBeCloseTo(100_000, 2);
    expect(result.trades.filter((t) => t.date === '2025-01-07')).toHaveLength(1);
  });

  it('skips symbol with missing price data', () => {
    const alloc = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 0.6],
      [{ symbol: 'MISSING', leverage: 1 }, 0.4],
    ]);
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);
    const prices = {
      SPY: { '2025-01-06': 500, '2025-01-07': 510 },
    };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].symbol).toBe('SPY');
    expect(result.series[0].value).toBeCloseTo(100_000, 2);
    expect(result.series[1].value).toBeCloseTo(101_200, 2);
  });

  it('returns empty results for empty bars', () => {
    const result = runSimulation([], {}, new Set(), cashPortfolio(100_000));
    expect(result.series).toHaveLength(0);
    expect(result.trades).toHaveLength(0);
  });

  it('returns finalPortfolio with starting cash for empty bars', () => {
    const result = runSimulation([], {}, new Set(), cashPortfolio(100_000));
    expect(result.finalPortfolio).toBeDefined();
    const holdingsMap = new Map(result.finalPortfolio.holdings.map(([t, qty]) => [t.symbol, qty]));
    expect(holdingsMap.get('CASHX')).toBeCloseTo(100_000, 2);
  });

  it('returns finalPortfolio with end-of-simulation positions and cash', () => {
    const alloc = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 0.6],
      [{ symbol: 'TLT', leverage: 1 }, 0.4],
    ]);
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);
    const prices = {
      SPY: { '2025-01-06': 500, '2025-01-07': 510 },
      TLT: { '2025-01-06': 100, '2025-01-07': 102 },
    };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    expect(result.finalPortfolio).toBeDefined();

    // After rebalance: SPY 60% = 60000/500 = 120 shares, TLT 40% = 40000/100 = 400 shares
    const holdingsMap = new Map(result.finalPortfolio.holdings.map(([t, qty]) => [t.symbol, qty]));
    expect(holdingsMap.get('SPY')).toBeCloseTo(120, 4);
    expect(holdingsMap.get('TLT')).toBeCloseTo(400, 4);

    // Cash should be ~0 after full allocation
    const cash = holdingsMap.get('CASHX') ?? 0;
    expect(cash).toBeCloseTo(0, 2);
  });

  it('starts simulation from existing positions', () => {
    const alloc = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 0.6],
      [{ symbol: 'TLT', leverage: 1 }, 0.4],
    ]);
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);

    const prices = {
      SPY: { '2025-01-06': 500, '2025-01-07': 510 },
      TLT: { '2025-01-06': 100, '2025-01-07': 102 },
    };
    const rebalanceDates = new Set(['2025-01-06']);

    // Start with 100 shares SPY + $20,000 cash (no TLT)
    // Total value: 100*500 + 20000 = 70000
    const portfolio = stubPortfolio([
      [{ symbol: 'SPY', leverage: 1 }, 100],
      [{ symbol: 'CASHX', leverage: 1 }, 20_000],
    ]);

    const result = runSimulation(bars, prices, rebalanceDates, portfolio);

    // Day 1 rebalance: target SPY = 42000 (84 shares), target TLT = 28000 (280 shares)
    // Sell 16 SPY, buy 280 TLT
    const spyTrade = result.trades.find((t) => t.symbol === 'SPY');
    const tltTrade = result.trades.find((t) => t.symbol === 'TLT');

    expect(spyTrade).toBeDefined();
    expect(spyTrade!.action).toBe('sell');
    expect(spyTrade!.quantity).toBeCloseTo(16, 4);

    expect(tltTrade).toBeDefined();
    expect(tltTrade!.action).toBe('buy');
    expect(tltTrade!.quantity).toBeCloseTo(280, 4);

    // Portfolio value stays at 70000 on day 1
    expect(result.series[0].value).toBeCloseTo(70_000, 0);
    // Day 2: 84 * 510 + 280 * 102 = 42840 + 28560 = 71400
    expect(result.series[1].value).toBeCloseTo(71_400, 0);
  });
});
