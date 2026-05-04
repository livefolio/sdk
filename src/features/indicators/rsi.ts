import type { Series } from '../../interfaces/types';

/**
 * Computes the Relative Strength Index (RSI) using Wilder's smoothing method.
 *
 * Math definition:
 * ```
 * changes[i] = series[i] - series[i-1]
 *
 * // Seed from simple averages of the first `period` changes:
 * avgGain[0] = mean(max(changes[0..period-1], 0))
 * avgLoss[0] = mean(max(-changes[0..period-1], 0))
 *
 * // Wilder's smoothing for subsequent periods:
 * avgGain[i] = (avgGain[i-1] * (period-1) + gain[i]) / period
 * avgLoss[i] = (avgLoss[i-1] * (period-1) + loss[i]) / period
 *
 * RS[i]  = avgGain[i] / avgLoss[i]
 * RSI[i] = 100 - 100 / (1 + RS[i])
 * ```
 *
 * Special case: when `avgLoss === 0`, RSI is clamped to 100 (infinite RS means
 * no losing periods in the window).
 *
 * Warmup: requires `period + 1` input bars to produce the first RSI value
 * (one extra bar for the initial change calculation). The first output point
 * corresponds to input index `period`. The output array is shorter than the
 * input (no `undefined` placeholders).
 *
 * Edge cases:
 * - `period <= 0` — throws `Error`.
 * - `series.length < period + 1` — returns `[]`.
 * - Flat price series (all changes = 0) — returns RSI values of 100 because
 *   `avgLoss` stays 0.
 *
 * @param series - Input price series sorted in ascending timestamp order.
 * @param period - Lookback window in bars for Wilder's smoothing. Must be a
 *   positive integer; 14 is the conventional default.
 * @returns A `Series` of length `max(0, series.length - period)`. Each point's
 *   timestamp `t` is taken from the corresponding input bar. Values are in
 *   the range `[0, 100]`.
 *
 * @example
 * ```ts
 * import { rsi } from '@livefolio/sdk';
 *
 * // Minimal example: 5 bars, period 3 → 2 RSI values
 * const prices = [
 *   { t: new Date('2023-01-02'), v: 100 },
 *   { t: new Date('2023-01-03'), v: 102 },
 *   { t: new Date('2023-01-04'), v: 101 },
 *   { t: new Date('2023-01-05'), v: 105 },
 *   { t: new Date('2023-01-06'), v: 104 },
 * ];
 *
 * const result = rsi(prices, 3);
 * // result.length === 2
 * // result[0].t => new Date('2023-01-05')
 * // result[1].t => new Date('2023-01-06')
 * // values are in [0, 100]
 * ```
 */
export function rsi(series: Series, period: number): Series {
  if (period <= 0) throw new Error(`rsi: period must be positive, got ${period}`);
  if (series.length < period + 1) return [];
  const changes: number[] = [];
  for (let i = 1; i < series.length; i++) {
    changes.push(series[i]!.v - series[i - 1]!.v);
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i]! > 0) avgGain += changes[i]!;
    else avgLoss += Math.abs(changes[i]!);
  }
  avgGain /= period;
  avgLoss /= period;
  const out: { t: Date; v: number }[] = [];
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  out.push({
    t: series[period]!.t,
    v: avgLoss === 0 ? 100 : 100 - 100 / (1 + rs),
  });
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i]! > 0 ? changes[i]! : 0;
    const loss = changes[i]! < 0 ? Math.abs(changes[i]!) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const smoothRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push({
      t: series[i + 1]!.t,
      v: avgLoss === 0 ? 100 : 100 - 100 / (1 + smoothRs),
    });
  }
  return out;
}
