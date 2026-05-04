import type { Series } from '../../interfaces/types';

/**
 * Computes an Exponential Moving Average (EMA) over a price series.
 *
 * Math definition:
 * ```
 * k   = 2 / (period + 1)          // smoothing factor
 * EMA[0] = SMA(series[0..period-1])  // seeded from simple average
 * EMA[i] = series[i] * k + EMA[i-1] * (1 - k)
 * ```
 *
 * Warmup: the first `period - 1` input bars are consumed to seed the SMA
 * initial value. The first EMA output point corresponds to input index
 * `period - 1`; subsequent points are computed from the recursive formula.
 * The output array is shorter than the input (no `undefined` placeholders).
 *
 * Edge cases:
 * - `period <= 0` — throws `Error`.
 * - `series.length < period` — returns `[]` (not enough data to seed the EMA).
 * - `series.length === period` — returns a single-point `Series` equal to the
 *   simple average of all input values.
 *
 * @param series - Input price series sorted in ascending timestamp order.
 * @param period - Lookback window in bars. Must be a positive integer. Controls
 *   the smoothing factor `k = 2 / (period + 1)`: smaller periods react faster
 *   to recent prices.
 * @returns A `Series` of length `max(0, series.length - period + 1)`. Each
 *   point's timestamp `t` is taken from the corresponding input bar.
 *
 * @example
 * ```ts
 * import { ema } from '@livefolio/sdk';
 *
 * const prices = [
 *   { t: new Date('2023-01-02'), v: 100 },
 *   { t: new Date('2023-01-03'), v: 110 },
 *   { t: new Date('2023-01-04'), v: 120 },
 *   { t: new Date('2023-01-05'), v: 130 },
 * ];
 *
 * const result = ema(prices, 3);
 * // result.length === 2
 * // result[0] => { t: new Date('2023-01-04'), v: 110 }  // SMA seed: (100+110+120)/3
 * // result[1] => { t: new Date('2023-01-05'), v: ~116.7 } // EMA: 130*0.5 + 110*0.5
 * ```
 */
export function ema(series: Series, period: number): Series {
  if (period <= 0) throw new Error(`ema: period must be positive, got ${period}`);
  if (series.length < period) return [];
  const k = 2 / (period + 1);
  const out: { t: Date; v: number }[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += series[i]!.v;
  let prev = sum / period;
  out.push({ t: series[period - 1]!.t, v: prev });
  for (let i = period; i < series.length; i++) {
    prev = series[i]!.v * k + prev * (1 - k);
    out.push({ t: series[i]!.t, v: prev });
  }
  return out;
}
