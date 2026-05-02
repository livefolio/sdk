import type { Bar, Series } from '../interfaces/types';

/**
 * The OHLCV field of a `Bar` that should be used when converting a bar array
 * into a scalar time series. Defaults to `'close'` throughout the feature
 * pipeline unless overridden via `FeatureRuntimeOptions.field`.
 *
 * Variants: `'open'` | `'high'` | `'low'` | `'close'` | `'volume'`.
 */
export type BarField = 'open' | 'high' | 'low' | 'close' | 'volume';

/**
 * Drains an `AsyncIterable<Bar>` into a plain `Bar[]` array.
 *
 * Used internally by `FeatureRuntime` to materialise the stream returned by
 * `DataFeed.bars` before passing it to indicator functions that expect a
 * fully-in-memory array. The resulting array is in the same order as the
 * iterable yields (typically chronological).
 *
 * @param it - Any `AsyncIterable<Bar>`, such as the return value of `DataFeed.bars`.
 * @returns A promise that resolves to a `Bar[]` containing every bar yielded
 *   by the iterable, in iteration order.
 *
 * @example
 * ```ts
 * import { collectBars } from '@livefolio/sdk';
 *
 * const bars = await collectBars(dataFeed.bars(asset, range, '1d'));
 * // bars is now a Bar[] — safe to index, slice, and pass to barsToSeries
 * ```
 */
export async function collectBars(it: AsyncIterable<Bar>): Promise<Bar[]> {
  const out: Bar[] = [];
  for await (const b of it) out.push(b);
  return out;
}

/**
 * Converts an array of OHLCV bars into a `Series` by extracting a single
 * numeric field from each bar.
 *
 * The resulting `Series` is a readonly array of `{ t: Date; v: number }` points
 * in the same order as `bars`. The timestamp `t` is taken directly from `bar.t`,
 * and `v` is the value of `field` for that bar.
 *
 * @param bars - Source OHLCV bars in chronological order.
 * @param field - Which OHLCV field to extract. Defaults to `'close'`.
 * @returns A `Series` of the same length as `bars`. Returns an empty array when
 *   `bars` is empty.
 *
 * @example
 * ```ts
 * import { collectBars, barsToSeries } from '@livefolio/sdk';
 *
 * const bars = await collectBars(dataFeed.bars(asset, range, '1d'));
 * const closeSeries = barsToSeries(bars);           // default: 'close'
 * const volumeSeries = barsToSeries(bars, 'volume');
 * ```
 */
export function barsToSeries(bars: ReadonlyArray<Bar>, field: BarField = 'close'): Series {
  return bars.map((b) => ({ t: b.t, v: b[field] }));
}

/**
 * Looks up the value at or immediately before timestamp `t` in a sorted `Series`.
 *
 * Uses binary search to find the largest index `i` where `series[i].t <= t`.
 * This is the standard "as-of" lookup used throughout the strategy loop to read
 * the most recent indicator value available on a given session date without
 * peeking into the future.
 *
 * @param series - A `Series` sorted in ascending timestamp order. Behaviour is
 *   undefined for unsorted input.
 * @param t - The target date. May fall between two data points or exactly on one.
 * @returns The `v` value of the last data point at or before `t`, or `undefined`
 *   if the series is empty or every point comes after `t`.
 *
 * @example
 * ```ts
 * import { seriesAt } from '@livefolio/sdk';
 *
 * const series = [
 *   { t: new Date('2023-01-02'), v: 380.0 },
 *   { t: new Date('2023-01-03'), v: 385.0 },
 *   { t: new Date('2023-01-04'), v: 390.0 },
 * ];
 *
 * seriesAt(series, new Date('2023-01-03')); // => 385.0 (exact match)
 * seriesAt(series, new Date('2023-01-03T12:00:00Z')); // => 385.0 (between points)
 * seriesAt(series, new Date('2023-01-01')); // => undefined (before all points)
 * ```
 */
export function seriesAt(series: Series, t: Date): number | undefined {
  if (series.length === 0) return undefined;
  const target = t.getTime();
  // binary search for largest index where series[i].t <= target
  let lo = 0;
  let hi = series.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (series[mid]!.t.getTime() <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans < 0 ? undefined : series[ans]!.v;
}
