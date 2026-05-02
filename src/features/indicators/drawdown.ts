import type { Series } from '../../interfaces/types';

/**
 * Computes the rolling drawdown relative to the period high for each bar.
 *
 * Math definition:
 * ```
 * rollingMax[i] = max(series[i-period+1], ..., series[i])
 * drawdown[i]   = (series[i] - rollingMax[i]) / rollingMax[i]
 * ```
 *
 * The result is a non-positive fraction (e.g. `-0.15` means the current price
 * is 15 % below the period high). A value of `0` means the current price equals
 * the rolling maximum — i.e. the asset is at a new high within the window.
 *
 * Warmup: the first output point corresponds to input index `period - 1` (the
 * first complete window). The output array is shorter than the input by
 * `period - 1` points (no `undefined` placeholders).
 *
 * Edge cases:
 * - `period <= 0` — throws `Error`.
 * - `series.length < period` — returns `[]`.
 * - All prices in a window are equal — returns `0` (current equals max).
 * - Zero prices in the window — produces `NaN` (division by zero); callers
 *   should guard against zero-price series.
 *
 * @param series - Input price series sorted in ascending timestamp order. Values
 *   should be positive (non-zero) to avoid `NaN` results.
 * @param period - Rolling window size in bars. Must be a positive integer.
 *   A value of `1` always returns `0` (current equals one-bar max).
 * @returns A `Series` of length `max(0, series.length - period + 1)`. Each
 *   point's timestamp `t` is taken from `series[i]` (the last bar in its window).
 *   Values are in the range `(-∞, 0]` but in practice within `[-1, 0]` for
 *   positive price series.
 *
 * @example
 * ```ts
 * import { drawdown } from '@livefolio/sdk';
 *
 * const prices = [
 *   { t: new Date('2023-01-02'), v: 100 },
 *   { t: new Date('2023-01-03'), v: 105 },
 *   { t: new Date('2023-01-04'), v: 95  },
 *   { t: new Date('2023-01-05'), v: 98  },
 * ];
 *
 * const dd = drawdown(prices, 3);
 * // dd.length === 2
 * // dd[0].t => new Date('2023-01-04'), dd[0].v => (95-105)/105 ≈ -0.095
 * // dd[1].t => new Date('2023-01-05'), dd[1].v => (98-105)/105 ≈ -0.067
 * ```
 */
export function drawdown(series: Series, period: number): Series {
  if (period <= 0) throw new Error(`drawdown: period must be positive, got ${period}`);
  if (series.length < period) return [];
  const out: { t: Date; v: number }[] = [];
  for (let i = period - 1; i < series.length; i++) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (series[j]!.v > max) max = series[j]!.v;
    }
    out.push({ t: series[i]!.t, v: (series[i]!.v - max) / max });
  }
  return out;
}
