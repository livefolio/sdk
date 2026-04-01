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
