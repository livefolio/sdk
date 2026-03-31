import type { Database } from './database.types.js';
import type { TypedSupabaseClient } from './types.js';
import { TickerHandle } from './handles/ticker.js';
import { IndicatorHandle } from './handles/indicator.js';

type IndicatorType = Database['public']['Enums']['indicator_type'];
type Unit = Database['public']['Enums']['unit'];

type TreasuryTenor = Extract<
  IndicatorType,
  'T3M' | 'T6M' | 'T1Y' | 'T2Y' | 'T3Y' | 'T5Y' | 'T7Y' | 'T10Y' | 'T20Y' | 'T30Y'
>;
type CalendarPeriod = Extract<IndicatorType, 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year'>;

interface IndicatorOpts {
  delay?: number;
}

export interface LivefolioClient {
  ticker(symbol: string, leverage?: number): TickerHandle;

  // Ticker-bound
  sma(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;
  ema(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;
  price(ticker: TickerHandle, opts?: IndicatorOpts): IndicatorHandle;
  returns(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;
  volatility(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;
  drawdown(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;
  rsi(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;

  // Standalone
  vix(opts?: IndicatorOpts): IndicatorHandle;
  vix3m(opts?: IndicatorOpts): IndicatorHandle;
  treasury(tenor: TreasuryTenor, opts?: IndicatorOpts): IndicatorHandle;
  calendar(period: CalendarPeriod, opts?: IndicatorOpts): IndicatorHandle;

  // Threshold
  threshold(value: number, unit?: Unit): IndicatorHandle;
}

export interface LivefolioClientOptions {
  supabase: TypedSupabaseClient;
}

function tickerBound(
  sb: TypedSupabaseClient,
  type: IndicatorType,
  ticker: TickerHandle,
  lookback: number,
  opts?: IndicatorOpts,
): IndicatorHandle {
  return new IndicatorHandle(sb, {
    type,
    ticker,
    lookback,
    delay: opts?.delay ?? 0,
    unit: null,
    threshold: null,
  });
}

function standalone(sb: TypedSupabaseClient, type: IndicatorType, opts?: IndicatorOpts): IndicatorHandle {
  return new IndicatorHandle(sb, {
    type,
    ticker: null,
    lookback: 0,
    delay: opts?.delay ?? 0,
    unit: null,
    threshold: null,
  });
}

export function createClient(options: LivefolioClientOptions): LivefolioClient {
  const sb = options.supabase;

  return {
    ticker: (symbol, leverage) => new TickerHandle(sb, symbol, leverage),

    sma: (ticker, lookback, opts?) => tickerBound(sb, 'SMA', ticker, lookback, opts),
    ema: (ticker, lookback, opts?) => tickerBound(sb, 'EMA', ticker, lookback, opts),
    price: (ticker, opts?) => tickerBound(sb, 'Price', ticker, 0, opts),
    returns: (ticker, lookback, opts?) => tickerBound(sb, 'Return', ticker, lookback, opts),
    volatility: (ticker, lookback, opts?) => tickerBound(sb, 'Volatility', ticker, lookback, opts),
    drawdown: (ticker, lookback, opts?) => tickerBound(sb, 'Drawdown', ticker, lookback, opts),
    rsi: (ticker, lookback, opts?) => tickerBound(sb, 'RSI', ticker, lookback, opts),

    vix: (opts?) => standalone(sb, 'VIX', opts),
    vix3m: (opts?) => standalone(sb, 'VIX3M', opts),
    treasury: (tenor, opts?) => standalone(sb, tenor, opts),
    calendar: (period, opts?) => standalone(sb, period, opts),

    threshold: (value, unit?) =>
      new IndicatorHandle(sb, {
        type: 'Threshold',
        ticker: null,
        lookback: 0,
        delay: 0,
        unit: unit ?? null,
        threshold: value,
      }),
  };
}
