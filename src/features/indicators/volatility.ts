import type { Series } from '../../interfaces/types';

/**
 * Computes a rolling historical volatility as the population standard deviation
 * of daily log-like returns over a sliding window.
 *
 * Math definition:
 * ```
 * dailyReturn[i] = series[i] / series[i-1] - 1   // simple period return
 *
 * // For each window of `period` daily returns ending at index i:
 * mean     = Σ dailyReturn[i..i-period+1] / period
 * variance = Σ (dailyReturn[j] - mean)² / period   // population variance
 * vol[i]   = sqrt(variance)
 * ```
 *
 * The result is the per-bar standard deviation expressed as a fraction (e.g.
 * `0.012` ≈ 1.2 % daily volatility). To annualise, multiply by `sqrt(252)` for
 * daily bars.
 *
 * Warmup: requires `period + 1` price bars to produce the first volatility value:
 * one extra bar to compute the first daily return, then `period` returns for the
 * first window. The first output point corresponds to the `period`-th daily-return
 * index. The output array is shorter than the input (no `undefined` placeholders).
 *
 * Edge cases:
 * - `period <= 0` — throws `Error`.
 * - `series.length < period + 1` — returns `[]`.
 * - Flat price series (all returns = 0) — returns volatility values of `0`.
 *
 * @param series - Input price series sorted in ascending timestamp order. Values
 *   must be positive (non-zero); zero prices produce `NaN` daily returns.
 * @param period - Window size in daily-return bars. Must be a positive integer;
 *   common values are 20 (≈ 1 month) or 252 (1 year) for daily data.
 * @returns A `Series` of length `max(0, series.length - period)`. Each point's
 *   timestamp `t` is taken from the last daily-return bar in its window.
 *
 * @example
 * ```ts
 * import { volatility } from '@livefolio/sdk';
 *
 * // 5 price bars → 4 daily returns → 1 vol point (period=4)
 * const prices = [
 *   { t: new Date('2023-01-02'), v: 100 },
 *   { t: new Date('2023-01-03'), v: 101 },
 *   { t: new Date('2023-01-04'), v: 99  },
 *   { t: new Date('2023-01-05'), v: 102 },
 *   { t: new Date('2023-01-06'), v: 100 },
 * ];
 *
 * const vol = volatility(prices, 4);
 * // vol.length === 1
 * // vol[0].t => new Date('2023-01-06')
 * // vol[0].v => population std-dev of the 4 daily returns (≈ 0.012)
 * ```
 */
export function volatility(series: Series, period: number): Series {
  if (period <= 0) throw new Error(`volatility: period must be positive, got ${period}`);
  if (series.length < period + 1) return [];
  const dailyReturns: { t: Date; v: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    dailyReturns.push({
      t: series[i]!.t,
      v: series[i]!.v / series[i - 1]!.v - 1,
    });
  }
  if (dailyReturns.length < period) return [];
  const out: { t: Date; v: number }[] = [];
  for (let i = period - 1; i < dailyReturns.length; i++) {
    const window = dailyReturns.slice(i - period + 1, i + 1);
    const mean = window.reduce((s, r) => s + r.v, 0) / period;
    const variance = window.reduce((s, r) => s + (r.v - mean) ** 2, 0) / period;
    out.push({ t: dailyReturns[i]!.t, v: Math.sqrt(variance) });
  }
  return out;
}
