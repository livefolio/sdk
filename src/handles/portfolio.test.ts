import { describe, it, expect } from 'vitest';
import { PortfolioHandle } from './portfolio';
import { TickerHandle } from './ticker';
import type { StorageProvider } from '../providers/storage';
import { AllocationHandle } from './allocation';

function mockStorage() {
  return {} as StorageProvider;
}

describe('PortfolioHandle construction', () => {
  it('stores holdings as ticker-quantity pairs', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const cashx = new TickerHandle(sb, 'CASHX');
    const handle = new PortfolioHandle([
      [spy, 500],
      [cashx, 5000],
    ]);

    expect(handle.holdings).toHaveLength(2);
    expect(handle.holdings[0][0]).toBe(spy);
    expect(handle.holdings[0][1]).toBe(500);
    expect(handle.holdings[1][0]).toBe(cashx);
    expect(handle.holdings[1][1]).toBe(5000);
  });

  it('throws on duplicate tickers', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    expect(
      () =>
        new PortfolioHandle([
          [spy, 500],
          [spy, 200],
        ]),
    ).toThrow('Duplicate ticker');
  });

  it('accepts negative quantities (borrowed / short positions)', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const handle = new PortfolioHandle([[spy, -100]]);
    expect(handle.holdings).toHaveLength(1);
    expect(handle.holdings[0]![1]).toBe(-100);
  });

  it('accepts zero-quantity holdings', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    expect(() => new PortfolioHandle([[spy, 0]])).not.toThrow();
  });

  it('accepts empty holdings', () => {
    expect(() => new PortfolioHandle([])).not.toThrow();
  });
});

describe('PortfolioHandle.value', () => {
  it('computes total portfolio value from positions and prices', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([
      [spy, 500],
      [bnd, 200],
      [cashx, 5000],
    ]);

    const prices: [TickerHandle, number][] = [
      [spy, 520.5],
      [bnd, 72.3],
    ];
    // 500 * 520.50 + 200 * 72.30 + 5000 * 1.0 = 260250 + 14460 + 5000 = 279710
    expect(portfolio.value(prices)).toBeCloseTo(279710, 2);
  });

  it('treats CASHX price as 1.0 even if provided in prices', () => {
    const sb = mockStorage();
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([[cashx, 10000]]);

    // Provide a bogus CASHX price — should be ignored
    const prices: [TickerHandle, number][] = [[cashx, 999]];
    expect(portfolio.value(prices)).toBeCloseTo(10000, 2);
  });

  it('throws if a non-CASHX ticker is missing from prices', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const portfolio = new PortfolioHandle([[spy, 500]]);

    expect(() => portfolio.value([])).toThrow('Missing price for SPY');
  });

  it('returns 0 for empty portfolio', () => {
    const portfolio = new PortfolioHandle([]);
    expect(portfolio.value([])).toBe(0);
  });
});

describe('PortfolioHandle.weights', () => {
  it('computes allocation weights from positions and prices', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([
      [spy, 500],
      [bnd, 200],
      [cashx, 5000],
    ]);

    const prices: [TickerHandle, number][] = [
      [spy, 520.5],
      [bnd, 72.3],
    ];
    const weights = portfolio.weights(prices);

    // Total = 279710
    // SPY: 260250 / 279710 ≈ 0.9304
    // BND: 14460 / 279710 ≈ 0.0517
    // CASHX: 5000 / 279710 ≈ 0.0179
    expect(weights).toHaveLength(3);
    expect(weights[0][0]).toBe(spy);
    expect(weights[0][1]).toBeCloseTo(0.9304, 3);
    expect(weights[1][0]).toBe(bnd);
    expect(weights[1][1]).toBeCloseTo(0.0517, 3);
    expect(weights[2][0]).toBe(cashx);
    expect(weights[2][1]).toBeCloseTo(0.0179, 3);
  });

  it('returns empty array for empty portfolio', () => {
    const portfolio = new PortfolioHandle([]);
    expect(portfolio.weights([])).toEqual([]);
  });

  it('skips zero-quantity holdings', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const portfolio = new PortfolioHandle([
      [spy, 100],
      [bnd, 0],
    ]);

    const prices: [TickerHandle, number][] = [
      [spy, 500],
      [bnd, 100],
    ];
    const weights = portfolio.weights(prices);

    expect(weights).toHaveLength(1);
    expect(weights[0][0]).toBe(spy);
    expect(weights[0][1]).toBeCloseTo(1.0, 4);
  });
});

describe('PortfolioHandle.trades', () => {
  it('computes buy and sell trades to reach target allocation', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([
      [spy, 100],
      [bnd, 50],
      [cashx, 10000],
    ]);

    // Target: 60/40
    const target = new AllocationHandle(sb, [
      [spy, 0.6],
      [bnd, 0.4],
    ]);

    const prices: [TickerHandle, number][] = [
      [spy, 500],
      [bnd, 100],
    ];
    // Total value: 100*500 + 50*100 + 10000 = 65000
    // Target SPY: 65000 * 0.6 = 39000, current: 50000, delta: -11000, sell 22 shares
    // Target BND: 65000 * 0.4 = 26000, current: 5000, delta: +21000, buy 210 shares
    const trades = portfolio.trades(target, prices, '2026-03-31');

    const sellTrades = trades.filter((t) => t.action === 'sell');
    const buyTrades = trades.filter((t) => t.action === 'buy');

    expect(sellTrades).toHaveLength(1);
    expect(sellTrades[0].symbol).toBe('SPY');
    expect(sellTrades[0].quantity).toBeCloseTo(22, 4);
    expect(sellTrades[0].price).toBe(500);
    expect(sellTrades[0].date).toBe('2026-03-31');

    expect(buyTrades).toHaveLength(1);
    expect(buyTrades[0].symbol).toBe('BND');
    expect(buyTrades[0].quantity).toBeCloseTo(210, 4);
    expect(buyTrades[0].price).toBe(100);
    expect(buyTrades[0].date).toBe('2026-03-31');
  });

  it('orders sells before buys', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([
      [spy, 100],
      [bnd, 50],
      [cashx, 10000],
    ]);
    const target = new AllocationHandle(sb, [
      [spy, 0.6],
      [bnd, 0.4],
    ]);
    const prices: [TickerHandle, number][] = [
      [spy, 500],
      [bnd, 100],
    ];

    const trades = portfolio.trades(target, prices, '2026-03-31');

    const firstBuyIndex = trades.findIndex((t) => t.action === 'buy');
    const lastSellIndex =
      trades
        .map((t, i) => (t.action === 'sell' ? i : -1))
        .filter((i) => i >= 0)
        .pop() ?? -1;

    if (firstBuyIndex >= 0 && lastSellIndex >= 0) {
      expect(lastSellIndex).toBeLessThan(firstBuyIndex);
    }
  });

  it('sells entire position for tickers not in target', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const gld = new TickerHandle(sb, 'GLD');
    const portfolio = new PortfolioHandle([
      [spy, 100],
      [gld, 50],
    ]);
    const target = new AllocationHandle(sb, [[bnd, 1.0]]);
    const prices: [TickerHandle, number][] = [
      [spy, 500],
      [gld, 200],
      [bnd, 100],
    ];

    const trades = portfolio.trades(target, prices, '2026-03-31');

    const spySell = trades.find((t) => t.symbol === 'SPY' && t.action === 'sell');
    const gldSell = trades.find((t) => t.symbol === 'GLD' && t.action === 'sell');
    const bndBuy = trades.find((t) => t.symbol === 'BND' && t.action === 'buy');

    expect(spySell).toBeDefined();
    expect(spySell!.quantity).toBe(100);
    expect(gldSell).toBeDefined();
    expect(gldSell!.quantity).toBe(50);
    expect(bndBuy).toBeDefined();
    expect(bndBuy!.quantity).toBeCloseTo(600, 4);
  });

  it('returns empty array when portfolio is already at target', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const portfolio = new PortfolioHandle([
      [spy, 600],
      [bnd, 400],
    ]);
    const target = new AllocationHandle(sb, [
      [spy, 0.6],
      [bnd, 0.4],
    ]);
    const prices: [TickerHandle, number][] = [
      [spy, 100],
      [bnd, 100],
    ];

    const trades = portfolio.trades(target, prices, '2026-03-31');
    expect(trades).toEqual([]);
  });

  it('handles CASHX target weight by keeping cash portion', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([
      [spy, 100],
      [cashx, 50000],
    ]);
    const target = new AllocationHandle(sb, [
      [spy, 0.6],
      [cashx, 0.4],
    ]);
    const prices: [TickerHandle, number][] = [[spy, 500]];

    const trades = portfolio.trades(target, prices, '2026-03-31');
    expect(trades).toHaveLength(1);
    expect(trades[0].symbol).toBe('SPY');
    expect(trades[0].action).toBe('buy');
    expect(trades[0].quantity).toBeCloseTo(20, 4);
  });

  it('never emits a CASHX trade', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([
      [spy, 100],
      [cashx, 50000],
    ]);
    const target = new AllocationHandle(sb, [[spy, 1.0]]);
    const prices: [TickerHandle, number][] = [[spy, 500]];

    const trades = portfolio.trades(target, prices, '2026-03-31');
    const cashTrades = trades.filter((t) => t.symbol === 'CASHX');
    expect(cashTrades).toHaveLength(0);
  });

  it('throws if a portfolio ticker is missing from prices', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const portfolio = new PortfolioHandle([[spy, 100]]);
    const target = new AllocationHandle(sb, [[bnd, 1.0]]);

    expect(() => portfolio.trades(target, [], '2026-03-31')).toThrow('Missing price');
  });

  it('throws if a target-only ticker is missing from prices', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const portfolio = new PortfolioHandle([[spy, 100]]);
    const target = new AllocationHandle(sb, [[bnd, 1.0]]);

    expect(() => portfolio.trades(target, [[spy, 500]], '2026-03-31')).toThrow('Missing price');
  });
});
