/**
 * Stable string identifier for an asset. Matches the `id` field of {@link Asset}.
 * Use this type when you only need to key or compare assets without carrying
 * the full {@link Asset} object.
 */
export type AssetId = string;

/**
 * An equity instrument — common stock or ETF.
 *
 * @example
 * ```ts
 * const aapl: EquityAsset = {
 *   kind: 'equity',
 *   id: 'AAPL',
 *   symbol: 'AAPL',
 *   exchange: 'NASDAQ',
 * };
 * ```
 */
export type EquityAsset = {
  kind: 'equity';
  /** Stable opaque ID — typically the ticker, but treat as opaque. */
  id: AssetId;
  /** Display symbol, e.g. `'AAPL'`. */
  symbol: string;
  /** MIC or common exchange name, e.g. `'NYSE'`, `'NASDAQ'`. Optional. */
  exchange?: string;
};

/**
 * A macroeconomic time series — e.g. a FRED series like `DGS10` (10-year
 * Treasury yield) or `CPIAUCSL` (CPI, all items). Models single-value series
 * as bars whose OHLC are equal to the published value.
 *
 * @example
 * ```ts
 * const dgs10: MacroAsset = {
 *   kind: 'macro',
 *   id: 'DGS10',
 *   symbol: '10Y Treasury',
 *   source: 'FRED',
 * };
 * ```
 */
export type MacroAsset = {
  kind: 'macro';
  /** Provider-scoped series ID, e.g. `'DGS10'`, `'CPIAUCSL'`. */
  id: AssetId;
  /** Human-readable label, e.g. `'10Y Treasury'`, `'CPI'`. */
  symbol: string;
  /** Data provider tag, e.g. `'FRED'`. Optional. */
  source?: string;
};

/**
 * A tradeable or queryable instrument. Discriminated by `kind`. Add a new
 * variant to this union when introducing a new asset class (futures, option,
 * crypto, etc.); each variant is the natural narrowing point for vendor-
 * specific fields.
 */
export type Asset = EquityAsset | MacroAsset;

/**
 * Bar granularity. Determines the width of each {@link Bar} returned by
 * {@link DataFeed.bars}.
 *
 * - `'1m'`  — one-minute bars
 * - `'5m'`  — five-minute bars
 * - `'15m'` — fifteen-minute bars
 * - `'1h'`  — hourly bars
 * - `'1d'`  — daily bars (most common for end-of-day strategies)
 */
export type Frequency = '1m' | '5m' | '15m' | '1h' | '1d';

/**
 * Half-open calendar interval `[from, to)`. Used throughout the SDK wherever
 * a date range is required. `from` is inclusive; `to` is exclusive.
 *
 * @example
 * ```ts
 * import type { DateRange } from '@livefolio/sdk';
 *
 * const range: DateRange = {
 *   from: new Date('2024-01-01'),
 *   to:   new Date('2025-01-01'),
 * };
 * ```
 */
export type DateRange = {
  /** Inclusive start of the range. */
  from: Date;
  /** Exclusive end of the range. */
  to: Date;
};

/**
 * A single OHLCV bar for one asset at one point in time.
 *
 * @example
 * ```ts
 * import type { Bar } from '@livefolio/sdk';
 *
 * // Typical daily bar for a $150 stock
 * const bar: Bar = {
 *   t:      new Date('2024-06-01'),
 *   open:   150.0,
 *   high:   153.4,
 *   low:    149.1,
 *   close:  152.7,
 *   volume: 8_500_000,
 * };
 * ```
 */
export type Bar = {
  /** Bar timestamp (opening instant for intraday bars; midnight UTC for daily). */
  t: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Total shares traded during the bar period. */
  volume: number;
};

/**
 * An ordered time series of scalar values. Used as the output type of feature
 * computations and as the storage unit in {@link FeatureCache}.
 *
 * Each element pairs a timestamp `t` with a numeric value `v`. The array is
 * `ReadonlyArray`, so implementations must not mutate it after construction.
 */
export type Series = ReadonlyArray<{ t: Date; v: number }>;

/**
 * A cash distribution (dividend) or interest payment for an asset, carrying
 * what the SDK needs to credit cash and classify the income per-lot.
 *
 * `incomeKind: 'qualified-eligible'` means the distribution CAN be qualified if
 * a holding lot satisfies the 60-of-121-day rule; the runtime resolves the
 * actual qualified-vs-ordinary split per lot. `'ordinary'`/`'interest'` are
 * never qualified.
 */
export type DividendEvent = {
  asset: Asset;
  exDate: Date;
  payDate: Date;
  amountPerShare: number;
  incomeKind: 'qualified-eligible' | 'ordinary' | 'interest';
};
