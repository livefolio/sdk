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
      'SPY:1': {
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
    const prices = { 'SPY:1': { '2025-01-06': 500 } };
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
      'SPY:1': {
        '2025-01-06': 500,
        '2025-01-07': 520,
        '2025-01-08': 520,
        '2025-01-09': 520,
        '2025-01-10': 520,
      },
      'TLT:1': {
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
      'SPY:1': {
        '2025-01-06': 500,
        '2025-01-07': 510,
        '2025-01-08': 505,
      },
      'SHY:1': {
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
      'SPY:1': { '2025-01-06': 500, '2025-01-07': 510, '2025-01-08': 505 },
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
      'SPY:1': { '2025-01-06': 500, '2025-01-07': 510 },
    };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].symbol).toBe('SPY');
    expect(result.series[0].value).toBeCloseTo(100_000, 2);
    expect(result.series[1].value).toBeCloseTo(101_200, 2);
  });

  it('carries forward last known price when today is missing', () => {
    // Simulates a mutual fund whose NAV hasn't posted yet for the latest bar:
    // we must keep valuing the position at its last close, not drop it to $0.
    const alloc = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 0.8],
      [{ symbol: 'LCSIX', leverage: 1 }, 0.2],
    ]);
    const bars = makeBars(['2026-04-14', '2026-04-15', '2026-04-16'], alloc);
    const prices = {
      'SPY:1': {
        '2026-04-14': 500,
        '2026-04-15': 500,
        '2026-04-16': 500,
      },
      'LCSIX:1': {
        '2026-04-14': 100,
        '2026-04-15': 100,
        // '2026-04-16' missing — NAV not posted yet
      },
    };
    const rebalanceDates = new Set(['2026-04-14']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    expect(result.series[0].value).toBeCloseTo(100_000, 2);
    expect(result.series[1].value).toBeCloseTo(100_000, 2);
    // Without carry-forward, day 3 would collapse to 80,000 (the LCSIX slice zeroed).
    expect(result.series[2].value).toBeCloseTo(100_000, 2);
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
      'SPY:1': { '2025-01-06': 500, '2025-01-07': 510 },
      'TLT:1': { '2025-01-06': 100, '2025-01-07': 102 },
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
      'SPY:1': { '2025-01-06': 500, '2025-01-07': 510 },
      'TLT:1': { '2025-01-06': 100, '2025-01-07': 102 },
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

  it('handles same symbol at different leverage across allocations', () => {
    // QQQ:1x first, then QQQ:2x — the bug was that only one price series was used
    const alloc1x = stubAllocation([[{ symbol: 'QQQ', leverage: 1 }, 1.0]]);
    const alloc2x = stubAllocation([[{ symbol: 'QQQ', leverage: 2 }, 1.0]]);

    const bars: StrategyBar[] = [
      { date: '2025-01-06', allocation: alloc1x },
      { date: '2025-01-07', allocation: alloc1x },
      { date: '2025-01-08', allocation: alloc2x },
      { date: '2025-01-09', allocation: alloc2x },
    ];

    // Separate price series for each leverage variant
    const prices = {
      'QQQ:1': {
        '2025-01-06': 500,
        '2025-01-07': 510,
        '2025-01-08': 520,
        '2025-01-09': 530,
      },
      'QQQ:2': {
        '2025-01-06': 500,
        '2025-01-07': 520,
        '2025-01-08': 540,
        '2025-01-09': 560,
      },
    };
    const rebalanceDates = new Set(['2025-01-06', '2025-01-08']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    // Day 1: buy QQQ:1x @ 500 → 200 shares
    expect(result.series[0].value).toBeCloseTo(100_000, 0);
    // Day 2: 200 * 510 = 102,000 (using QQQ:1x prices)
    expect(result.series[1].value).toBeCloseTo(102_000, 0);
    // Day 3: rebalance to QQQ:2x. Portfolio = 200 * 520 = 104,000 (QQQ:1x price).
    //   Sell QQQ:1x, buy QQQ:2x @ 540 → 104000/540 ≈ 192.59 shares
    expect(result.series[2].value).toBeCloseTo(104_000, 0);
    // Day 4: 192.59 * 560 ≈ 107,852 (using QQQ:2x prices)
    expect(result.series[3].value).toBeCloseTo(107_852, 0);
  });

  it('uses correct leverage-keyed prices for trades', () => {
    const alloc1x = stubAllocation([[{ symbol: 'QQQ', leverage: 1 }, 1.0]]);
    const alloc2x = stubAllocation([[{ symbol: 'QQQ', leverage: 2 }, 1.0]]);

    const bars: StrategyBar[] = [
      { date: '2025-01-06', allocation: alloc1x },
      { date: '2025-01-07', allocation: alloc2x },
    ];

    const prices = {
      'QQQ:1': { '2025-01-06': 500, '2025-01-07': 510 },
      'QQQ:2': { '2025-01-06': 500, '2025-01-07': 520 },
    };
    const rebalanceDates = new Set(['2025-01-06', '2025-01-07']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    // Day 1: buy QQQ:1x
    const day1Trades = result.trades.filter((t) => t.date === '2025-01-06');
    expect(day1Trades).toHaveLength(1);
    expect(day1Trades[0].price).toBe(500);

    // Day 2: sell QQQ:1x @ 510, buy QQQ:2x @ 520
    const day2Trades = result.trades.filter((t) => t.date === '2025-01-07');
    expect(day2Trades).toHaveLength(2);
    const sell = day2Trades.find((t) => t.action === 'sell');
    const buy = day2Trades.find((t) => t.action === 'buy');
    expect(sell).toBeDefined();
    expect(sell!.price).toBe(510); // QQQ:1x price
    expect(buy).toBeDefined();
    expect(buy!.price).toBe(520); // QQQ:2x price
  });

  it('tracks finalPortfolio with correct leverage after switch', () => {
    const alloc1x = stubAllocation([[{ symbol: 'QQQ', leverage: 1 }, 1.0]]);
    const alloc2x = stubAllocation([[{ symbol: 'QQQ', leverage: 2 }, 1.0]]);

    const bars: StrategyBar[] = [
      { date: '2025-01-06', allocation: alloc1x },
      { date: '2025-01-07', allocation: alloc2x },
    ];

    const prices = {
      'QQQ:1': { '2025-01-06': 500, '2025-01-07': 510 },
      'QQQ:2': { '2025-01-06': 500, '2025-01-07': 520 },
    };
    const rebalanceDates = new Set(['2025-01-06', '2025-01-07']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    // Final portfolio should hold QQQ:2x, not QQQ:1x
    const holdings = result.finalPortfolio.holdings.filter(([t]) => t.symbol === 'QQQ');
    expect(holdings).toHaveLength(1);
    expect(holdings[0][0].leverage).toBe(2);
  });

  it('values rate-ticker positions at implicit $1 in NAV', () => {
    const alloc = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);
    // Starting portfolio includes a borrowed DTB3 position (allowed by Task 1).
    const portfolio = stubPortfolio([
      [{ symbol: 'CASHX', leverage: 1 }, 150_000],
      [{ symbol: 'DTB3', leverage: 1 }, -50_000],
    ]);
    const prices = { 'DTB3:1': { '2025-01-06': 5.25, '2025-01-07': 5.25 } };
    const rebalanceDates = new Set<string>(); // no rebalance — just value tracking

    const result = runSimulation(bars, prices, rebalanceDates, portfolio);

    // NAV = cash + DTB3 quantity × $1 = 150000 − 50000 = 100000
    expect(result.series[0]).toEqual({ date: '2025-01-06', value: 100_000 });
    // DTB3 accrues at 5.25% / 360 per day: -50000 × (1 + 0.0525/360) ≈ -50007.29
    // NAV = 150000 + (-50007.29) ≈ 99992.71
    const expectedDay1 = 150_000 + -50_000 * (1 + (0.0525 * 1) / 360);
    expect(result.series[1]!.value).toBeCloseTo(expectedDay1, 2);
  });

  it('rebalances into a borrowed rate-ticker leg at $1 price', () => {
    const alloc = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 1.5],
      [{ symbol: 'DTB3', leverage: 1 }, -0.5],
    ]);
    const bars = makeBars(['2025-01-06'], alloc);
    const prices = {
      'SPY:1': { '2025-01-06': 500 },
      'DTB3:1': { '2025-01-06': 5.25 },
    };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    // Target: SPY = 150k ÷ 500 = 300 shares; DTB3 = −50k ÷ $1 = −50000 shares.
    // Cash: 100k − (300 × 500) − (−50000 × 1) = 100k − 150k + 50k = 0.
    // NAV = 0 + 300×500 + (−50000)×1 = 100000.
    expect(result.series[0]).toEqual({ date: '2025-01-06', value: 100_000 });

    const tradeBySymbol = Object.fromEntries(result.trades.map((t) => [t.symbol, t]));
    expect(tradeBySymbol.SPY).toMatchObject({ action: 'buy', quantity: 300, price: 500 });
    expect(tradeBySymbol.DTB3).toMatchObject({ action: 'sell', quantity: 50_000, price: 1 });
  });

  it('accrues interest on rate-ticker positions per FRED 360-day convention', () => {
    const alloc = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    // Mon → Tue = 1 calendar day
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);
    const portfolio = stubPortfolio([
      [{ symbol: 'CASHX', leverage: 1 }, 0],
      [{ symbol: 'DTB3', leverage: 1 }, 100_000], // lent $100k
    ]);
    const prices = { 'DTB3:1': { '2025-01-06': 5.25, '2025-01-07': 5.25 } };

    const result = runSimulation(bars, prices, new Set(), portfolio);

    // Day 0: no accrual yet (first bar). NAV = 100_000.
    expect(result.series[0]!.value).toBeCloseTo(100_000, 2);
    // Day 1: positions *= 1 + 5.25/100 × 1/360 ≈ 1.00014583
    const expected = 100_000 * (1 + (0.0525 * 1) / 360);
    expect(result.series[1]!.value).toBeCloseTo(expected, 2);
  });

  it('accrues interest across weekend gaps (Fri → Mon = 3 days)', () => {
    const alloc = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    // 2025-01-03 is Fri, 2025-01-06 is Mon → 3 calendar days
    const bars = makeBars(['2025-01-03', '2025-01-06'], alloc);
    const portfolio = stubPortfolio([
      [{ symbol: 'CASHX', leverage: 1 }, 0],
      [{ symbol: 'DTB3', leverage: 1 }, 100_000],
    ]);
    const prices = { 'DTB3:1': { '2025-01-03': 5.25, '2025-01-06': 5.25 } };

    const result = runSimulation(bars, prices, new Set(), portfolio);

    const expected = 100_000 * (1 + (0.0525 * 3) / 360);
    expect(result.series[1]!.value).toBeCloseTo(expected, 2);
  });

  it('applies leverage multiplier to rate accrual', () => {
    const alloc = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);
    const portfolio = stubPortfolio([
      [{ symbol: 'CASHX', leverage: 1 }, 0],
      [{ symbol: 'DTB3', leverage: 2 }, 100_000], // DTB3?L=2, lent
    ]);
    const prices = { 'DTB3:2': { '2025-01-06': 5.25, '2025-01-07': 5.25 } };

    const result = runSimulation(bars, prices, new Set(), portfolio);

    // 2× accrual → 2 × 0.0525 × 1/360
    const expected = 100_000 * (1 + (2 * 0.0525 * 1) / 360);
    expect(result.series[1]!.value).toBeCloseTo(expected, 2);
  });

  it('skips accrual when rate is missing for the previous bar', () => {
    const alloc = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06', '2025-01-07', '2025-01-08'], alloc);
    const portfolio = stubPortfolio([
      [{ symbol: 'CASHX', leverage: 1 }, 0],
      [{ symbol: 'DTB3', leverage: 1 }, 100_000],
    ]);
    // Rate missing at 2025-01-06 → no accrual on the step to 2025-01-07
    const prices = { 'DTB3:1': { '2025-01-07': 5.25 } };

    const result = runSimulation(bars, prices, new Set(), portfolio);

    expect(result.series[1]!.value).toBeCloseTo(100_000, 2); // unchanged
    // Next step uses 2025-01-07's rate for the 2025-01-07 → 2025-01-08 gap
    const expected = 100_000 * (1 + (0.0525 * 1) / 360);
    expect(result.series[2]!.value).toBeCloseTo(expected, 2);
  });

  it('rebalances out of a borrowed rate leg cleanly', () => {
    const allocBorrow = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 1.5],
      [{ symbol: 'DTB3', leverage: 1 }, -0.5],
    ]);
    const allocCash = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    const bars: StrategyBar[] = [
      { date: '2025-01-06', allocation: allocBorrow },
      { date: '2025-01-07', allocation: allocCash },
    ];
    const prices = {
      'SPY:1': { '2025-01-06': 500, '2025-01-07': 500 }, // flat SPY
      'DTB3:1': { '2025-01-06': 0, '2025-01-07': 0 }, // 0% rate → no accrual effect
    };
    const rebalanceDates = new Set(['2025-01-06', '2025-01-07']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    // After day-2 rebalance: all cash, no positions.
    expect(result.finalPortfolio.holdings).toHaveLength(1);
    const [cashTicker, cashQty] = result.finalPortfolio.holdings[0]!;
    expect(cashTicker.symbol).toBe('CASHX');
    expect(cashQty).toBeCloseTo(100_000, 2);
  });
});
