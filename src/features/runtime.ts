import type { Asset, DateRange, Frequency, Series } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { FeatureCache, FeatureKey } from '../interfaces/feature-cache';
import { collectBars, barsToSeries, type BarField } from './series-utils';
import { getFeatureCompute, paramsHash, type FeatureSpec } from './spec';

/**
 * Configuration for a `FeatureRuntime` instance.
 *
 * All options are fixed at construction time. The `range` and `freq` fields
 * determine the bar window fetched from `DataFeed` and are also embedded in
 * every `FeatureKey` so that cache entries from different ranges cannot
 * accidentally collide.
 */
export type FeatureRuntimeOptions = {
  /** The market-data source used to fetch OHLCV bars. */
  dataFeed: DataFeed;
  /**
   * Persistent indicator cache. Use `MemoryFeatureCache` for a single backtest
   * run, or supply a cross-process cache implementation to share results across
   * multiple runs or processes.
   */
  featureCache: FeatureCache;
  /**
   * The date range over which bars are fetched. This should span at least the
   * backtest range plus any indicator warmup period (e.g. `period - 1` extra
   * bars for SMA/EMA). `FeatureRuntime` does not automatically extend the range
   * for warmup — the caller is responsible for providing enough history.
   */
  range: DateRange;
  /**
   * Bar frequency forwarded to `DataFeed.bars` and embedded in cache keys.
   * Must match the granularity expected by the indicators (e.g. `'1d'` for
   * daily SMA/EMA).
   */
  freq: Frequency;
  /**
   * Which OHLCV field to use as the scalar price series. Defaults to `'close'`.
   * All indicators within a single `FeatureRuntime` instance share the same field.
   */
  field?: BarField;
};

/**
 * Orchestrates indicator computation for a single backtest run.
 *
 * `FeatureRuntime` is the bridge between raw OHLCV data (via `DataFeed`) and the
 * typed indicator functions registered in the feature registry. It handles:
 *
 * - **Bar fetching** — Calls `DataFeed.bars` once per `(asset, range, freq)` tuple
 *   and caches the resulting `Series` in memory for the lifetime of the instance.
 *   Concurrent calls for the same asset share a single in-flight promise; there is
 *   no redundant fetching even if `compute` is called from multiple `Promise.all`
 *   branches simultaneously.
 * - **Indicator dispatch** — Delegates computation to the function registered via
 *   `defineFeature` for the given `FeatureSpec.kind`.
 * - **Persistent caching** — Checks `FeatureCache` before computing. On a miss,
 *   the result is stored in the cache. Subsequent calls with the same `(spec, asset)`
 *   combination return instantly from cache without re-fetching bars.
 *
 * Caching semantics:
 * - Cache keys incorporate `spec`, `asset.id`, `range`, and `freq` so results from
 *   different backtest configurations never collide.
 * - The `range` used in cache keys is the full range passed at construction, not a
 *   per-call range. If you need features over a narrower window, construct a new
 *   `FeatureRuntime` with the appropriate `range`.
 * - `FeatureRuntime` does not validate that the `range` is wide enough to accommodate
 *   the indicator warmup period. If the range is too short, indicator functions return
 *   an empty `Series`; `seriesAt` will then return `undefined` for all dates.
 *
 * Async behavior:
 * - `compute` is always async because `DataFeed.bars` and `FeatureCache.get/set` are
 *   async. Callers should `await` or `Promise.all` multiple calls in the `features`
 *   method of a `Strategy`.
 *
 * @example
 * ```ts
 * import {
 *   FeatureRuntime,
 *   MemoryFeatureCache,
 *   seriesAt,
 * } from '@livefolio/sdk';
 *
 * const runtime = new FeatureRuntime({
 *   dataFeed,
 *   featureCache: new MemoryFeatureCache(),
 *   range: { from: new Date('2022-01-01'), to: new Date('2023-12-31') },
 *   freq: '1d',
 * });
 *
 * const spy = { kind: 'equity' as const, id: 'US:SPY', symbol: 'SPY' };
 * const smaSeries = await runtime.compute({ kind: 'sma', period: 20 }, spy);
 * const latestSma = seriesAt(smaSeries, new Date('2023-06-15'));
 * // => number | undefined
 * ```
 */
export class FeatureRuntime {
  private readonly opts: FeatureRuntimeOptions;
  private readonly basePromises = new Map<string, Promise<Series>>();

  constructor(opts: FeatureRuntimeOptions) {
    this.opts = { field: 'close', ...opts };
  }

  private baseKey(asset: Asset): string {
    const r = this.opts.range;
    return `${asset.id}|${this.opts.freq}|${r.from.toISOString()}|${r.to.toISOString()}|${this.opts.field}`;
  }

  private async baseSeries(asset: Asset): Promise<Series> {
    const k = this.baseKey(asset);
    let p = this.basePromises.get(k);
    if (p) return p;
    p = (async () => {
      const bars = await collectBars(this.opts.dataFeed.bars(asset, this.opts.range, this.opts.freq));
      return barsToSeries(bars, this.opts.field);
    })();
    this.basePromises.set(k, p);
    return p;
  }

  private cacheKey(spec: FeatureSpec, asset: Asset): FeatureKey {
    return {
      feature: spec.kind,
      paramsHash: paramsHash(spec),
      scope: { kind: 'asset', asset: asset.id },
      range: this.opts.range,
      freq: this.opts.freq,
    };
  }

  /**
   * Computes (or retrieves from cache) the output `Series` for a given feature
   * spec applied to a specific asset.
   *
   * On the first call for a `(spec, asset)` pair:
   * 1. Fetches or reuses the in-memory base `Series` for the asset.
   * 2. Dispatches to the registered compute function for `spec.kind`.
   * 3. Stores the result in `featureCache`.
   *
   * On subsequent calls with the same `(spec, asset)` pair, returns the cached
   * `Series` directly, bypassing bar fetching and computation.
   *
   * @param spec - The feature specification describing which indicator to compute
   *   and its parameters (e.g. `{ kind: 'sma', period: 20 }`).
   * @param asset - The asset for which to compute the feature. The asset's `id`
   *   is used both for data fetching and cache key construction.
   * @returns A promise that resolves to the computed `Series`. The series length
   *   is determined by the indicator's warmup: for example, SMA(20) returns
   *   `series.length - 19` data points. Returns an empty array when the
   *   base series is shorter than the indicator's warmup period.
   *
   * @example
   * ```ts
   * const spy = { kind: 'equity' as const, id: 'US:SPY', symbol: 'SPY' };
   *
   * const [priceSeries, smaSeries] = await Promise.all([
   *   runtime.compute({ kind: 'price' }, spy),
   *   runtime.compute({ kind: 'sma', period: 20 }, spy),
   * ]);
   * ```
   */
  async compute(spec: FeatureSpec, asset: Asset): Promise<Series> {
    const key = this.cacheKey(spec, asset);
    const cached = await this.opts.featureCache.get(key);
    if (cached) return cached;
    const base = await this.baseSeries(asset);
    const compute = getFeatureCompute(spec.kind);
    const result = compute(base, spec);
    await this.opts.featureCache.set(key, result);
    return result;
  }
}
