import type { Series } from '../../interfaces/types';

/**
 * Computes a Simple Moving Average (SMA) over a price series.
 *
 * Math definition:
 * ```
 * SMA[i] = (series[i] + series[i-1] + ... + series[i-period+1]) / period
 * ```
 *
 * Warmup: the first output point corresponds to index `period - 1` in the input.
 * Inputs `series[0]` through `series[period - 2]` have no SMA value and are
 * excluded from the output entirely (no `undefined` placeholders; the output
 * array is shorter than the input).
 *
 * Edge cases:
 * - `period <= 0` — throws `Error`.
 * - `series.length < period` — returns `[]` (not enough data for even one window).
 * - `series.length === period` — returns a single-point `Series`.
 *
 * @param series - Input price series sorted in ascending timestamp order.
 * @param period - Window size in bars. Must be a positive integer.
 * @returns A `Series` of length `max(0, series.length - period + 1)`. Each point's
 *   timestamp `t` is taken from the last bar in its window (`series[i + period - 1]`).
 *
 * @example
 * ```ts
 * import { sma } from '@livefolio/sdk';
 *
 * const prices = [
 *   { t: new Date('2023-01-02'), v: 100 },
 *   { t: new Date('2023-01-03'), v: 110 },
 *   { t: new Date('2023-01-04'), v: 120 },
 *   { t: new Date('2023-01-05'), v: 130 },
 * ];
 *
 * const result = sma(prices, 3);
 * // result.length === 2
 * // result[0] => { t: new Date('2023-01-04'), v: 110 }  // (100+110+120)/3
 * // result[1] => { t: new Date('2023-01-05'), v: 120 }  // (110+120+130)/3
 * ```
 */
export function sma(series: Series, period: number): Series {
  if (period <= 0) throw new Error(`sma: period must be positive, got ${period}`);
  if (series.length < period) return [];
  const out: { t: Date; v: number }[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += series[i]!.v;
  out.push({ t: series[period - 1]!.t, v: sum / period });
  for (let i = period; i < series.length; i++) {
    sum += series[i]!.v - series[i - period]!.v;
    out.push({ t: series[i]!.t, v: sum / period });
  }
  return out;
}
