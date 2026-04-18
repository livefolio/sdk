import type { IndicatorType } from './types';

export type ProviderInfo =
  | { provider: 'yahoo'; symbol: string }
  | { provider: 'fred'; seriesId: string }
  | { provider: 'computed'; dependsOn: 'Price'; symbol: string }
  | { provider: 'calendar' }
  | { provider: 'none' };

const RATE_TICKER_SYMBOLS = new Set(['DTB3', 'DFF', 'DGS1', 'DGS2', 'DGS5', 'DGS10', 'DGS20', 'DGS30']);

export function isRateTickerSymbol(symbol: string | null): boolean {
  return symbol != null && RATE_TICKER_SYMBOLS.has(symbol);
}

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

const COMPUTED_TYPES = new Set<string>(['SMA', 'EMA', 'RSI', 'Return', 'Volatility', 'Drawdown']);
const CALENDAR_TYPES = new Set<string>(['Month', 'Day of Week', 'Day of Month', 'Day of Year']);

export function getProviderInfo(type: IndicatorType, tickerSymbol: string | null): ProviderInfo {
  if (type === 'Price') return { provider: 'yahoo', symbol: tickerSymbol! };
  if (type === 'VIX') return { provider: 'yahoo', symbol: '^VIX' };
  if (type === 'VIX3M') return { provider: 'yahoo', symbol: '^VIX3M' };

  if (type in FRED_SERIES) return { provider: 'fred', seriesId: FRED_SERIES[type] };

  if (COMPUTED_TYPES.has(type)) return { provider: 'computed', dependsOn: 'Price', symbol: tickerSymbol! };

  if (CALENDAR_TYPES.has(type)) return { provider: 'calendar' };

  return { provider: 'none' };
}
