import type { Ticker } from '../strategy/types';

/** Maps FRED rate symbols to brokerable equivalents. `null` = hold as cash. */
export const FRED_BROKERABLE_MAP: Record<string, string | null> = {
  DTB3: null,
  DFF: 'USFR',
};

/** Normalizes equivalent base tickers to a canonical symbol for leverage lookups. */
export const BASE_TICKER_ALIASES: Record<string, string> = {
  VOO: 'SPY',
  IVV: 'SPY',
};

/** Maps "SYMBOL:LEVERAGE" to the actual leveraged ETF ticker. */
export const LEVERAGED_ETF_MAP: Record<string, string> = {
  'SPY:2': 'SSO',
  'SPY:3': 'UPRO',
  'QQQ:2': 'QLD',
  'QQQ:3': 'TQQQ',
  'IWM:2': 'UWM',
  'IWM:3': 'TNA',
  'TLT:2': 'UBT',
  'TLT:3': 'TMF',
  'GLD:2': 'UGL',
};

/**
 * Maps a strategy ticker to its brokerable symbol.
 * Pipeline: FRED mapping -> leveraged ETF lookup (with alias normalization) -> passthrough.
 */
export function mapTickerToBrokerable(ticker: Ticker): string | null {
  const { symbol, leverage } = ticker;

  // FRED mapping takes priority
  if (symbol in FRED_BROKERABLE_MAP) return FRED_BROKERABLE_MAP[symbol];

  // Leveraged ETF lookup
  if (leverage > 1) {
    const canonical = BASE_TICKER_ALIASES[symbol] ?? symbol;
    const key = `${canonical}:${leverage}`;
    const mapped = LEVERAGED_ETF_MAP[key];
    if (mapped) return mapped;
    console.warn(`No leveraged ETF mapping for ${symbol} at ${leverage}x — passing through as ${symbol}`);
  }

  return symbol;
}
