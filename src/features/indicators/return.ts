import type { Series } from '../../interfaces/types';

/**
 * Controls whether `returnSeries` computes percentage or absolute returns.
 *
 * - `'pct'` (default) — percentage return: `(curr - prev) / prev`. The result is
 *   a dimensionless ratio (e.g. `0.05` means +5 %).
 * - `'abs'` — absolute price difference: `curr - prev`. The result is in the same
 *   units as the input price series.
 */
export type ReturnMode = 'pct' | 'abs';

/**
 * Computes a rolling period return over a price series.
 *
 * Math definition:
 * ```
 * // Percentage (default):
 * return[i] = (series[i] - series[i - period]) / series[i - period]
 *
 * // Absolute:
 * return[i] = series[i] - series[i - period]
 * ```
 *
 * Warmup: the first `period` bars are consumed as the lookback window for the
 * first output. The first output point corresponds to input index `period`.
 * The output array is shorter than the input (no `undefined` placeholders).
 *
 * Edge cases:
 * - `period <= 0` — throws `Error`.
 * - `series.length <= period` — returns `[]` (needs strictly more than `period` bars).
 * - `mode === 'pct'` with `prev === 0` — produces `Infinity` or `NaN`; callers
 *   should filter or guard against zero-price series.
 *
 * @param series - Input price series sorted in ascending timestamp order.
 * @param period - Lookback distance in bars. A value of `1` gives a single-bar
 *   (daily) return; larger values give multi-bar returns.
 * @param mode - Whether to return a percentage ratio or an absolute difference.
 *   Defaults to `'pct'`.
 * @returns A `Series` of length `max(0, series.length - period)`. Each point's
 *   timestamp `t` is taken from `series[i]` (the later of the two bars).
 *
 * @example
 * ```ts
 * import { returnSeries } from '@livefolio/sdk';
 *
 * const prices = [
 *   { t: new Date('2023-01-02'), v: 100 },
 *   { t: new Date('2023-01-03'), v: 105 },
 *   { t: new Date('2023-01-04'), v: 110 },
 * ];
 *
 * const pct = returnSeries(prices, 1);
 * // pct[0] => { t: new Date('2023-01-03'), v: 0.05 }  // (105-100)/100
 * // pct[1] => { t: new Date('2023-01-04'), v: ~0.048 } // (110-105)/105
 *
 * const abs = returnSeries(prices, 1, 'abs');
 * // abs[0] => { t: new Date('2023-01-03'), v: 5 }  // 105-100
 * // abs[1] => { t: new Date('2023-01-04'), v: 5 }  // 110-105
 *
 * // Two-bar return
 * const twoBar = returnSeries(prices, 2);
 * // twoBar[0] => { t: new Date('2023-01-04'), v: 0.1 } // (110-100)/100
 * ```
 */
export function returnSeries(series: Series, period: number, mode: ReturnMode = 'pct'): Series {
  if (period <= 0) throw new Error(`returnSeries: period must be positive, got ${period}`);
  if (series.length <= period) return [];
  const out: { t: Date; v: number }[] = [];
  for (let i = period; i < series.length; i++) {
    const curr = series[i]!.v;
    const prev = series[i - period]!.v;
    const v = mode === 'abs' ? curr - prev : (curr - prev) / prev;
    out.push({ t: series[i]!.t, v });
  }
  return out;
}
