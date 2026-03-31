import { describe, it, expect } from 'vitest';
import { getProviderInfo } from './mappings.js';

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

  it('maps T10Y to fred with DGS10 series', () => {
    expect(getProviderInfo('T10Y', null)).toEqual({ provider: 'fred', seriesId: 'DGS10' });
  });

  it('maps T3M to fred with DGS3MO series', () => {
    expect(getProviderInfo('T3M', null)).toEqual({ provider: 'fred', seriesId: 'DGS3MO' });
  });

  it('maps Month to calendar', () => {
    expect(getProviderInfo('Month', null)).toEqual({ provider: 'calendar' });
  });

  it('maps Threshold to none', () => {
    expect(getProviderInfo('Threshold', null)).toEqual({ provider: 'none' });
  });
});
