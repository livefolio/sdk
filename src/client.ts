import type { Database } from './database.types.js';
import type { TypedSupabaseClient } from './types.js';
import { TickerHandle } from './handles/ticker.js';
import { IndicatorHandle } from './handles/indicator.js';
import type { IndicatorConfig } from './handles/indicator.js';
import { SignalHandle } from './handles/signal.js';
import { AllocationHandle } from './handles/allocation.js';
import { StrategyHandle } from './handles/strategy.js';
import { PortfolioHandle } from './handles/portfolio.js';
import type { StrategyOptions } from './handles/strategy.js';

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

  // Signals
  gt(ind1: IndicatorHandle, ind2: IndicatorHandle, tolerance?: number): SignalHandle;
  lt(ind1: IndicatorHandle, ind2: IndicatorHandle, tolerance?: number): SignalHandle;
  eq(ind1: IndicatorHandle, ind2: IndicatorHandle, tolerance?: number): SignalHandle;

  // Allocations
  allocation(...holdings: [TickerHandle, number][]): AllocationHandle;

  // Portfolios
  portfolio(...holdings: [TickerHandle, number][]): PortfolioHandle;

  // Strategies
  strategy(linkId: string): StrategyHandle;
  strategy(options: StrategyOptions): StrategyHandle;
  strategy(optionsOrLinkId: string | StrategyOptions): StrategyHandle;
}

export interface LivefolioClientOptions {
  supabase: TypedSupabaseClient;
  fredApiKey?: string;
}

function tickerBound(
  sb: TypedSupabaseClient,
  type: IndicatorType,
  ticker: TickerHandle,
  lookback: number,
  opts?: IndicatorOpts,
  config?: IndicatorConfig,
): IndicatorHandle {
  return new IndicatorHandle(
    sb,
    {
      type,
      ticker,
      lookback,
      delay: opts?.delay ?? 0,
      unit: null,
      threshold: null,
    },
    config,
  );
}

function standalone(
  sb: TypedSupabaseClient,
  type: IndicatorType,
  opts?: IndicatorOpts,
  config?: IndicatorConfig,
): IndicatorHandle {
  return new IndicatorHandle(
    sb,
    {
      type,
      ticker: null,
      lookback: 0,
      delay: opts?.delay ?? 0,
      unit: null,
      threshold: null,
    },
    config,
  );
}

export function createClient(options: LivefolioClientOptions): LivefolioClient {
  const sb = options.supabase;
  const config: IndicatorConfig = { fredApiKey: options.fredApiKey };

  return {
    ticker: (symbol, leverage) => new TickerHandle(sb, symbol, leverage),

    sma: (ticker, lookback, opts?) => tickerBound(sb, 'SMA', ticker, lookback, opts, config),
    ema: (ticker, lookback, opts?) => tickerBound(sb, 'EMA', ticker, lookback, opts, config),
    price: (ticker, opts?) => tickerBound(sb, 'Price', ticker, 0, opts, config),
    returns: (ticker, lookback, opts?) => tickerBound(sb, 'Return', ticker, lookback, opts, config),
    volatility: (ticker, lookback, opts?) => tickerBound(sb, 'Volatility', ticker, lookback, opts, config),
    drawdown: (ticker, lookback, opts?) => tickerBound(sb, 'Drawdown', ticker, lookback, opts, config),
    rsi: (ticker, lookback, opts?) => tickerBound(sb, 'RSI', ticker, lookback, opts, config),

    vix: (opts?) => standalone(sb, 'VIX', opts, config),
    vix3m: (opts?) => standalone(sb, 'VIX3M', opts, config),
    treasury: (tenor, opts?) => standalone(sb, tenor, opts, config),
    calendar: (period, opts?) => standalone(sb, period, opts, config),

    threshold: (value, unit?) =>
      new IndicatorHandle(
        sb,
        {
          type: 'Threshold',
          ticker: null,
          lookback: 0,
          delay: 0,
          unit: unit ?? null,
          threshold: value,
        },
        config,
      ),

    gt: (ind1, ind2, tolerance?) =>
      new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: tolerance ?? 0 }, config),
    lt: (ind1, ind2, tolerance?) =>
      new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '<', tolerance: tolerance ?? 0 }, config),
    eq: (ind1, ind2, tolerance?) =>
      new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '=', tolerance: tolerance ?? 0 }, config),

    allocation: (...holdings) => new AllocationHandle(sb, holdings),

    portfolio: (...holdings) => new PortfolioHandle(holdings),

    strategy: (optionsOrLinkId: StrategyOptions | string) => new StrategyHandle(sb, optionsOrLinkId, config),
  };
}
