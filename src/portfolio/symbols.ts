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

/** Maps "SYMBOL:LEVERAGE" to the actual leveraged/inverse ETF ticker. Covers bull (2x/3x) and inverse (-1x/-2x/-3x). */
export const ETF_LEVERAGE_MAP: Record<string, string> = {
  // Bull — Broad market
  'SPY:2': 'SSO',
  'SPY:3': 'UPRO',
  'QQQ:2': 'QLD',
  'QQQ:3': 'TQQQ',
  'IWM:2': 'UWM',
  'IWM:3': 'TNA',
  'DIA:2': 'DDM',
  'DIA:3': 'UDOW',
  'MDY:2': 'MVV',
  'MDY:3': 'UMDD',

  // Bull — Bonds
  'TLT:2': 'UBT',
  'TLT:3': 'TMF',

  // Bull — Sectors
  'XLF:2': 'UYG',
  'XLF:3': 'FAS',
  'XLE:2': 'DIG',
  'XLK:2': 'ROM',
  'XLK:3': 'TECL',
  'XLV:2': 'RXL',
  'XLV:3': 'CURE',
  'XLU:2': 'UPW',
  'XLB:2': 'UYM',
  'XLP:2': 'UGE',
  'XLY:2': 'UCC',
  'XLI:2': 'UXI',
  'XLI:3': 'DUSL',
  'XLRE:2': 'URE',
  'XLRE:3': 'DRN',
  'SOXX:2': 'USD',
  'SOXX:3': 'SOXL',

  // Bull — International
  'EEM:2': 'EET',
  'EEM:3': 'EDC',
  'EFA:2': 'EFO',
  'FXI:3': 'YINN',

  // Bull — Commodities
  'GLD:2': 'UGL',
  'SLV:2': 'AGQ',
  'USO:2': 'UCO',
  'GDX:2': 'NUGT',

  // Bull — Crypto
  'BTC-USD:2': 'BITU',

  // Inverse — Broad market
  'SPY:-1': 'SH',
  'SPY:-2': 'SDS',
  'SPY:-3': 'SPXU',
  'QQQ:-1': 'PSQ',
  'QQQ:-2': 'QID',
  'QQQ:-3': 'SQQQ',
  'IWM:-1': 'RWM',
  'IWM:-2': 'TWM',
  'IWM:-3': 'TZA',
  'DIA:-1': 'DOG',
  'DIA:-2': 'DXD',
  'DIA:-3': 'SDOW',
  'MDY:-3': 'SMDD',

  // Inverse — Bonds
  'TLT:-1': 'TBF',
  'TLT:-2': 'TBT',
  'TLT:-3': 'TMV',

  // Inverse — Sectors
  'XLF:-2': 'SKF',
  'XLF:-3': 'FAZ',
  'XLE:-2': 'DUG',
  'XLK:-3': 'TECS',
  'SOXX:-3': 'SOXS',

  // Inverse — International
  'EEM:-2': 'EEV',
  'EEM:-3': 'EDZ',

  // Inverse — Commodities
  'GLD:-2': 'GLL',
};

/**
 * Maps a strategy ticker to its brokerable symbol.
 * Pipeline: FRED mapping -> leveraged/inverse ETF lookup (with alias normalization) -> passthrough.
 */
export function mapTickerToBrokerable(ticker: Ticker): string | null {
  const { symbol, leverage } = ticker;

  // FRED mapping takes priority
  if (symbol in FRED_BROKERABLE_MAP) return FRED_BROKERABLE_MAP[symbol];

  // Leveraged/inverse ETF lookup
  if (leverage !== 1) {
    const canonical = BASE_TICKER_ALIASES[symbol] ?? symbol;
    const key = `${canonical}:${leverage}`;
    const mapped = ETF_LEVERAGE_MAP[key];
    if (!mapped) {
      throw new Error(`No leveraged ETF mapping for ${symbol} at ${leverage}x`);
    }
    return mapped;
  }

  return symbol;
}
