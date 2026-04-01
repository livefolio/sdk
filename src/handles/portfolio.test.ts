import { describe, it, expect } from 'vitest';
import { PortfolioHandle } from './portfolio.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

function mockSupabase() {
  return {} as TypedSupabaseClient;
}

describe('PortfolioHandle construction', () => {
  it('stores holdings as ticker-quantity pairs', () => {
    const sb = mockSupabase();
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
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    expect(
      () =>
        new PortfolioHandle([
          [spy, 500],
          [spy, 200],
        ]),
    ).toThrow('Duplicate ticker');
  });

  it('throws on negative quantities', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    expect(() => new PortfolioHandle([[spy, -100]])).toThrow('negative');
  });

  it('accepts zero-quantity holdings', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    expect(() => new PortfolioHandle([[spy, 0]])).not.toThrow();
  });

  it('accepts empty holdings', () => {
    expect(() => new PortfolioHandle([])).not.toThrow();
  });
});

describe('PortfolioHandle.value', () => {
  it('computes total portfolio value from positions and prices', () => {
    const sb = mockSupabase();
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
    const sb = mockSupabase();
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([[cashx, 10000]]);

    // Provide a bogus CASHX price — should be ignored
    const prices: [TickerHandle, number][] = [[cashx, 999]];
    expect(portfolio.value(prices)).toBeCloseTo(10000, 2);
  });

  it('throws if a non-CASHX ticker is missing from prices', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const portfolio = new PortfolioHandle([[spy, 500]]);

    expect(() => portfolio.value([])).toThrow('Missing price for SPY');
  });

  it('returns 0 for empty portfolio', () => {
    const portfolio = new PortfolioHandle([]);
    expect(portfolio.value([])).toBe(0);
  });
});
