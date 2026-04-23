import type { StorageProvider } from './providers/storage';
import type { MarketProvider } from './providers/market';
import type { IndicatorType, Unit } from './providers/types';
import { TickerHandle } from './handles/ticker';
import { IndicatorHandle } from './handles/indicator';
import { SignalHandle } from './handles/signal';
import { AllocationHandle } from './handles/allocation';
import { StrategyHandle } from './handles/strategy';
import { PortfolioHandle } from './handles/portfolio';
import type { StrategyOptions } from './handles/strategy';

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
  storage: StorageProvider;
  market: MarketProvider;
}

function tickerBound(
  storage: StorageProvider,
  market: MarketProvider,
  type: IndicatorType,
  ticker: TickerHandle,
  lookback: number,
  opts?: IndicatorOpts,
): IndicatorHandle {
  return new IndicatorHandle(storage, market, {
    type,
    ticker,
    lookback,
    delay: opts?.delay ?? 0,
    unit: null,
    threshold: null,
  });
}

function standalone(
  storage: StorageProvider,
  market: MarketProvider,
  type: IndicatorType,
  opts?: IndicatorOpts,
): IndicatorHandle {
  return new IndicatorHandle(storage, market, {
    type,
    ticker: null,
    lookback: 0,
    delay: opts?.delay ?? 0,
    unit: null,
    threshold: null,
  });
}

export function createClient(options: LivefolioClientOptions): LivefolioClient {
  const { storage, market } = options;

  return {
    ticker: (symbol, leverage) => new TickerHandle(storage, symbol, leverage),

    sma: (ticker, lookback, opts?) => tickerBound(storage, market, 'SMA', ticker, lookback, opts),
    ema: (ticker, lookback, opts?) => tickerBound(storage, market, 'EMA', ticker, lookback, opts),
    price: (ticker, opts?) => tickerBound(storage, market, 'Price', ticker, 0, opts),
    returns: (ticker, lookback, opts?) => tickerBound(storage, market, 'Return', ticker, lookback, opts),
    volatility: (ticker, lookback, opts?) => tickerBound(storage, market, 'Volatility', ticker, lookback, opts),
    drawdown: (ticker, lookback, opts?) => tickerBound(storage, market, 'Drawdown', ticker, lookback, opts),
    rsi: (ticker, lookback, opts?) => tickerBound(storage, market, 'RSI', ticker, lookback, opts),

    vix: (opts?) => standalone(storage, market, 'VIX', opts),
    vix3m: (opts?) => standalone(storage, market, 'VIX3M', opts),
    treasury: (tenor, opts?) => standalone(storage, market, tenor, opts),
    calendar: (period, opts?) => standalone(storage, market, period, opts),

    threshold: (value, unit?) =>
      new IndicatorHandle(storage, market, {
        type: 'Threshold',
        ticker: null,
        // Thresholds are constants — lookback/delay are semantically unused,
        // but the DB's canonical form has (lookback=1, delay=0). Matching that
        // lets `indicators.findOrCreate` reuse existing rows instead of creating
        // duplicates at (lookback=0, delay=0) that the schema permits.
        lookback: 1,
        delay: 0,
        unit: unit ?? null,
        threshold: value,
      }),

    gt: (ind1, ind2, tolerance?) =>
      new SignalHandle(storage, market, {
        indicator1: ind1,
        indicator2: ind2,
        comparison: '>',
        tolerance: tolerance ?? 0,
      }),
    lt: (ind1, ind2, tolerance?) =>
      new SignalHandle(storage, market, {
        indicator1: ind1,
        indicator2: ind2,
        comparison: '<',
        tolerance: tolerance ?? 0,
      }),
    eq: (ind1, ind2, tolerance?) =>
      new SignalHandle(storage, market, {
        indicator1: ind1,
        indicator2: ind2,
        comparison: '=',
        tolerance: tolerance ?? 0,
      }),

    allocation: (...holdings) => new AllocationHandle(storage, holdings),

    portfolio: (...holdings) => new PortfolioHandle(holdings),

    strategy: (optionsOrLinkId: StrategyOptions | string) => new StrategyHandle(storage, market, optionsOrLinkId),
  };
}
