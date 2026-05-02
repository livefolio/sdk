import { describe, it, expect } from 'vitest';
import { getProviderInfo, isRateTickerSymbol } from './mappings';

describe('getProviderInfo', () => {
  it('maps Price to yahoo with ticker symbol', () => {
    expect(getProviderInfo('Price', 'SPY')).toEqual({ provider: 'yahoo', symbol: 'SPY' });
  });

  it('maps SMA to computed with ticker dependency', () => {
    expect(getProviderInfo('SMA', 'SPY')).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'SPY' });
  });

  it('maps EMA to computed', () => {
    expect(getProviderInfo('EMA', 'QQQ')).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'QQQ' });
  });

  it('maps RSI to computed', () => {
    expect(getProviderInfo('RSI', 'SPY')).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'SPY' });
  });

  it('maps Return to computed', () => {
    expect(getProviderInfo('Return', 'SPY')).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'SPY' });
  });

  it('maps Volatility to computed', () => {
    expect(getProviderInfo('Volatility', 'SPY')).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'SPY' });
  });

  it('maps Drawdown to computed', () => {
    expect(getProviderInfo('Drawdown', 'SPY')).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'SPY' });
  });

  it('maps VIX to yahoo with ^VIX symbol', () => {
    expect(getProviderInfo('VIX', null)).toEqual({ provider: 'yahoo', symbol: '^VIX' });
  });

  it('maps VIX3M to yahoo with ^VIX3M symbol', () => {
    expect(getProviderInfo('VIX3M', null)).toEqual({ provider: 'yahoo', symbol: '^VIX3M' });
  });

  it('maps T10Y to fred with rateSeries flag', () => {
    expect(getProviderInfo('T10Y', null)).toEqual({ provider: 'fred', seriesId: 'DGS10', rateSeries: true });
  });

  it('maps T3M to fred with rateSeries flag', () => {
    expect(getProviderInfo('T3M', null)).toEqual({ provider: 'fred', seriesId: 'DGS3MO', rateSeries: true });
  });

  it('maps Month to calendar', () => {
    expect(getProviderInfo('Month', null)).toEqual({ provider: 'calendar' });
  });

  it('maps Threshold to none', () => {
    expect(getProviderInfo('Threshold', null)).toEqual({ provider: 'none' });
  });

  it('flags Price indicator on a rate ticker with rateSeries', () => {
    expect(getProviderInfo('Price', 'DTB3')).toEqual({
      provider: 'yahoo',
      symbol: 'DTB3',
      rateSeries: true,
    });
    expect(getProviderInfo('Price', 'DFF')).toEqual({
      provider: 'yahoo',
      symbol: 'DFF',
      rateSeries: true,
    });
  });

  it('does not flag Price indicator on non-rate tickers', () => {
    const info = getProviderInfo('Price', 'SPY');
    expect(info).toEqual({ provider: 'yahoo', symbol: 'SPY' });
    expect((info as { rateSeries?: true }).rateSeries).toBeUndefined();
  });

  it('flags computed indicator (Return/SMA/etc.) on a rate ticker with rateSeries', () => {
    expect(getProviderInfo('Return', 'DTB3')).toEqual({
      provider: 'computed',
      dependsOn: 'Price',
      symbol: 'DTB3',
      rateSeries: true,
    });
    expect(getProviderInfo('SMA', 'DFF')).toEqual({
      provider: 'computed',
      dependsOn: 'Price',
      symbol: 'DFF',
      rateSeries: true,
    });
  });

  it('does not flag computed indicator on non-rate tickers', () => {
    const info = getProviderInfo('Return', 'SPY');
    expect((info as { rateSeries?: true }).rateSeries).toBeUndefined();
  });
});

describe('isRateTickerSymbol', () => {
  it('returns true for known rate tickers', () => {
    for (const sym of [
      'DTB3',
      'DTB6',
      'DFF',
      'DGS3MO',
      'DGS6MO',
      'DGS1',
      'DGS2',
      'DGS3',
      'DGS5',
      'DGS7',
      'DGS10',
      'DGS20',
      'DGS30',
    ]) {
      expect(isRateTickerSymbol(sym)).toBe(true);
    }
  });

  it('returns false for equity and ETF tickers', () => {
    for (const sym of ['SPY', 'QQQ', 'TLT', 'GLD', 'CASHX', 'VIX', 'BTC-USD']) {
      expect(isRateTickerSymbol(sym)).toBe(false);
    }
  });

  it('returns false for null', () => {
    expect(isRateTickerSymbol(null)).toBe(false);
  });
});
