import type { IndicatorType } from './types';

export type ProviderInfo =
  | { provider: 'yahoo'; symbol: string; rateSeries?: true }
  | { provider: 'fred'; seriesId: string; rateSeries?: true }
  | { provider: 'computed'; dependsOn: 'Price'; symbol: string; rateSeries?: true }
  | { provider: 'calendar' }
  | { provider: 'none' };

const FRED_SERIES: Record<string, string> = {
  T3M: 'DGS3MO',
  T6M: 'DGS6MO',
  T1Y: 'DGS1',
  T2Y: 'DGS2',
  T3Y: 'DGS3',
  T5Y: 'DGS5',
  T7Y: 'DGS7',
  T10Y: 'DGS10',
  T20Y: 'DGS20',
  T30Y: 'DGS30',
};

// Ticker symbols whose "price" values are rates/yields (expressed in percent),
// not prices. For these, percent-change returns are both broken (divide by
// zero / sign flips) and semantically wrong — callers should use absolute
// differences instead.
const RATE_TICKER_SYMBOLS = new Set<string>([
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
]);

const COMPUTED_TYPES = new Set<string>(['SMA', 'EMA', 'RSI', 'Return', 'Volatility', 'Drawdown']);
const CALENDAR_TYPES = new Set<string>(['Month', 'Day of Week', 'Day of Month', 'Day of Year']);

export function isRateTickerSymbol(symbol: string | null): boolean {
  return symbol != null && RATE_TICKER_SYMBOLS.has(symbol);
}

export function getProviderInfo(type: IndicatorType, tickerSymbol: string | null): ProviderInfo {
  if (type === 'Price') {
    const info: ProviderInfo = { provider: 'yahoo', symbol: tickerSymbol! };
    if (isRateTickerSymbol(tickerSymbol)) info.rateSeries = true;
    return info;
  }
  if (type === 'VIX') return { provider: 'yahoo', symbol: '^VIX' };
  if (type === 'VIX3M') return { provider: 'yahoo', symbol: '^VIX3M' };

  if (type in FRED_SERIES) return { provider: 'fred', seriesId: FRED_SERIES[type]!, rateSeries: true };

  if (COMPUTED_TYPES.has(type)) {
    const info: ProviderInfo = { provider: 'computed', dependsOn: 'Price', symbol: tickerSymbol! };
    if (isRateTickerSymbol(tickerSymbol)) info.rateSeries = true;
    return info;
  }

  if (CALENDAR_TYPES.has(type)) return { provider: 'calendar' };

  return { provider: 'none' };
}
