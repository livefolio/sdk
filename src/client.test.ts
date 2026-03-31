import { describe, it, expect } from 'vitest';
import { createClient } from './client.js';
import { TickerHandle } from './handles/ticker.js';
import { IndicatorHandle } from './handles/indicator.js';
import { SignalHandle } from './handles/signal.js';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { TypedSupabaseClient } from './types.js';

function testSupabase() {
  return createSupabaseClient('https://test.supabase.co', 'test-key') as unknown as TypedSupabaseClient;
}

describe('sdk.ticker', () => {
  it('returns a TickerHandle', () => {
    const sdk = createClient({ supabase: testSupabase() });
    const spy = sdk.ticker('SPY');
    expect(spy).toBeInstanceOf(TickerHandle);
    expect(spy.symbol).toBe('SPY');
    expect(spy.leverage).toBe(1);
  });

  it('accepts explicit leverage', () => {
    const sdk = createClient({ supabase: testSupabase() });
    const spxl = sdk.ticker('SPXL', 3);
    expect(spxl.leverage).toBe(3);
  });
});

describe('ticker-bound indicator factories', () => {
  const sdk = createClient({ supabase: testSupabase() });
  const spy = sdk.ticker('SPY');

  it('sdk.sma()', () => {
    const h = sdk.sma(spy, 200);
    expect(h).toBeInstanceOf(IndicatorHandle);
    expect(h.type).toBe('SMA');
    expect(h.lookback).toBe(200);
    expect(h.delay).toBe(0);
    expect(h.ticker).toBe(spy);
  });

  it('sdk.sma() with delay', () => {
    const h = sdk.sma(spy, 200, { delay: 1 });
    expect(h.delay).toBe(1);
  });

  it('sdk.ema()', () => {
    const h = sdk.ema(spy, 50);
    expect(h.type).toBe('EMA');
    expect(h.lookback).toBe(50);
  });

  it('sdk.price()', () => {
    const h = sdk.price(spy);
    expect(h.type).toBe('Price');
    expect(h.lookback).toBe(0);
  });

  it('sdk.returns()', () => {
    const h = sdk.returns(spy, 20);
    expect(h.type).toBe('Return');
    expect(h.lookback).toBe(20);
  });

  it('sdk.volatility()', () => {
    const h = sdk.volatility(spy, 30);
    expect(h.type).toBe('Volatility');
    expect(h.lookback).toBe(30);
  });

  it('sdk.drawdown()', () => {
    const h = sdk.drawdown(spy, 252);
    expect(h.type).toBe('Drawdown');
    expect(h.lookback).toBe(252);
  });

  it('sdk.rsi()', () => {
    const h = sdk.rsi(spy, 14);
    expect(h.type).toBe('RSI');
    expect(h.lookback).toBe(14);
  });
});

describe('standalone indicator factories', () => {
  const sdk = createClient({ supabase: testSupabase() });

  it('sdk.vix()', () => {
    const h = sdk.vix();
    expect(h.type).toBe('VIX');
    expect(h.ticker).toBeNull();
    expect(h.lookback).toBe(0);
  });

  it('sdk.vix3m()', () => {
    const h = sdk.vix3m();
    expect(h.type).toBe('VIX3M');
    expect(h.ticker).toBeNull();
  });

  it('sdk.treasury()', () => {
    const h = sdk.treasury('T10Y');
    expect(h.type).toBe('T10Y');
    expect(h.ticker).toBeNull();
  });

  it('sdk.calendar()', () => {
    const h = sdk.calendar('Month');
    expect(h.type).toBe('Month');
    expect(h.ticker).toBeNull();
  });
});

describe('threshold factory', () => {
  const sdk = createClient({ supabase: testSupabase() });

  it('sdk.threshold() without unit', () => {
    const h = sdk.threshold(0.5);
    expect(h.type).toBe('Threshold');
    expect(h.threshold).toBe(0.5);
    expect(h.unit).toBeNull();
    expect(h.ticker).toBeNull();
  });

  it('sdk.threshold() with unit', () => {
    const h = sdk.threshold(5, '%');
    expect(h.threshold).toBe(5);
    expect(h.unit).toBe('%');
  });
});

describe('signal factories', () => {
  const sdk = createClient({ supabase: testSupabase() });
  const spy = sdk.ticker('SPY');
  const price = sdk.price(spy);
  const sma = sdk.sma(spy, 200);

  it('sdk.gt()', () => {
    const h = sdk.gt(price, sma);
    expect(h).toBeInstanceOf(SignalHandle);
    expect(h.comparison).toBe('>');
    expect(h.tolerance).toBe(0);
    expect(h.indicator1).toBe(price);
    expect(h.indicator2).toBe(sma);
  });

  it('sdk.gt() with tolerance', () => {
    const h = sdk.gt(price, sma, 5);
    expect(h.tolerance).toBe(5);
  });

  it('sdk.lt()', () => {
    const h = sdk.lt(price, sma);
    expect(h).toBeInstanceOf(SignalHandle);
    expect(h.comparison).toBe('<');
  });

  it('sdk.eq()', () => {
    const h = sdk.eq(price, sma, 1);
    expect(h).toBeInstanceOf(SignalHandle);
    expect(h.comparison).toBe('=');
    expect(h.tolerance).toBe(1);
  });
});
