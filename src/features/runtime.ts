import type { Asset, AssetId, Bar, DateRange, Frequency, Series } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { FeatureCache, FeatureKey } from '../interfaces/feature-cache';
import { collectBars, barsToSeries, type BarField } from './series-utils';
import { getFeatureCompute, paramsHash, type FeatureSpec } from './spec';

/** Sentinel range used as the `range` field in cache keys for streaming-mode
 *  computations. Epoch-zero dates are never valid historical ranges, so this
 *  value cannot collide with any real historical cache entry. */
const STREAMING_SENTINEL_RANGE: DateRange = { from: new Date(0), to: new Date(0) };

/**
 * Configuration for a `FeatureRuntime` instance.
 *
 * Accepts two shapes — select via the `mode` discriminant:
 *
 * - **`'historical'`** (default, `mode` may be omitted): range-bounded backtest
 *   mode. Bars are fetched from `DataFeed` once per asset and cached in memory.
 * - **`'streaming'`**: open-ended live mode. No fixed `range`; bars are pushed
 *   in via `appendBar`. Indicator computation reads from the growing in-process
 *   buffer instead of calling `DataFeed.bars`.
 *
 * The historical variant is backward-compatible — existing callers that omit
 * `mode` compile and behave identically to before.
 */
export type FeatureRuntimeOptions =
  | {
      /** Selects historical (range-bounded) mode. May be omitted; defaults to
       *  `'historical'`. */
      mode?: 'historical';
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
    }
  | {
      /** Selects streaming (open-ended live) mode. Required. */
      mode: 'streaming';
      /** Kept on the type for interface symmetry but is NOT called in streaming mode.
       *  Supply `{ bars: vi.fn() }` in tests. */
      dataFeed: DataFeed;
      /**
       * Persistent indicator cache. Cache keys for streaming computations use a
       * sentinel `range` (`{ from: new Date(0), to: new Date(0) }`) to avoid
       * collision with historical entries stored under the same cache instance.
       */
      featureCache: FeatureCache;
      /**
       * Bar frequency embedded in cache keys. Must match the granularity of the
       * bars pushed via `appendBar`.
       */
      freq: Frequency;
      /**
       * Which OHLCV field to use as the scalar price series. Defaults to `'close'`.
       */
      field?: BarField;
      /**
       * Optional seed bars per asset (keyed by `AssetId`), used to bootstrap the
       * streaming buffer from a prior historical run's `BacktestResult`.
       * Bars must already be in ascending `t` order per asset.
       */
      initialBars?: ReadonlyMap<AssetId, ReadonlyArray<Bar>>;
    };

/**
 * Orchestrates indicator computation for a single backtest run or a live
 * streaming session.
 *
 * `FeatureRuntime` is the bridge between raw OHLCV data (via `DataFeed`) and the
 * typed indicator functions registered in the feature registry. It handles:
 *
 * - **Bar fetching** (historical mode) — Calls `DataFeed.bars` once per
 *   `(asset, range, freq)` tuple and caches the resulting `Series` in memory for
 *   the lifetime of the instance. Concurrent calls for the same asset share a
 *   single in-flight promise; there is no redundant fetching even if `compute` is
 *   called from multiple `Promise.all` branches simultaneously.
 * - **Bar buffering** (streaming mode) — Bars are pushed in via `appendBar`.
 *   `compute` reads directly from the in-memory buffer; `DataFeed.bars` is never
 *   called.
 * - **Indicator dispatch** — Delegates computation to the function registered via
 *   `defineFeature` for the given `FeatureSpec.kind`.
 * - **Persistent caching** — Checks `FeatureCache` before computing. On a miss,
 *   the result is stored in the cache. Subsequent calls with the same `(spec, asset)`
 *   combination return instantly from cache without re-fetching bars.
 *
 * Caching semantics:
 * - Historical mode: cache keys incorporate `spec`, `asset.id`, `range`, and `freq`.
 * - Streaming mode: the `range` field in cache keys is replaced by a sentinel
 *   (`{ from: new Date(0), to: new Date(0) }`) so streaming entries never collide
 *   with historical entries stored in the same `MemoryFeatureCache`.
 * - Calling `appendBar` invalidates the in-memory series cache for that asset so
 *   the next `compute` call rebuilds the series from the updated buffer.
 *
 * @example Historical mode (default)
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
 *
 * @example Streaming mode
 * ```ts
 * const runtime = new FeatureRuntime({
 *   dataFeed,            // not called in streaming mode
 *   featureCache: new MemoryFeatureCache(),
 *   mode: 'streaming',
 *   freq: '1d',
 *   initialBars,         // optional seed from BacktestResult
 * });
 *
 * runtime.appendBar(spy, latestBar);
 * const smaSeries = await runtime.compute({ kind: 'sma', period: 20 }, spy);
 * ```
 */
export class FeatureRuntime {
  private readonly mode: 'historical' | 'streaming';
  private readonly dataFeed: DataFeed;
  private readonly featureCache: FeatureCache;
  private readonly range: DateRange | null;
  private readonly freq: Frequency;
  private readonly field: BarField;
  /** Per-asset bar buffer used in streaming mode. */
  private readonly streamingBars: Map<AssetId, Bar[]>;
  /** Per-asset in-flight Series promise — shared across concurrent `compute` calls
   *  for the same asset to avoid redundant bar fetching (historical) or rebuilding
   *  (streaming). Invalidated on `appendBar`. */
  private readonly seriesCache: Map<AssetId, Promise<Series>>;

  constructor(opts: FeatureRuntimeOptions) {
    this.mode = opts.mode ?? 'historical';
    this.dataFeed = opts.dataFeed;
    this.featureCache = opts.featureCache;
    this.freq = opts.freq;
    this.field = opts.field ?? 'close';
    this.seriesCache = new Map();
    this.streamingBars = new Map();

    if (this.mode === 'streaming') {
      this.range = null;
      const initial = (opts as Extract<FeatureRuntimeOptions, { mode: 'streaming' }>).initialBars;
      if (initial) {
        for (const [assetId, bars] of initial) {
          this.streamingBars.set(assetId, [...bars]);
        }
      }
    } else {
      this.range = (opts as Extract<FeatureRuntimeOptions, { mode?: 'historical' }>).range;
    }
  }

  /**
   * Appends a bar to the streaming buffer for the given asset.
   *
   * Bars must be provided in strictly ascending `t` order per asset. If a bar
   * is out of order (i.e. its `t` is ≤ the last buffered bar's `t`), this
   * method throws with an `"ascending"` message.
   *
   * Also invalidates the in-memory series cache for the asset so the next
   * `compute` call rebuilds the series from the updated buffer.
   *
   * @throws If called on a historical-mode runtime.
   * @throws If `bar.t` is not strictly greater than the last buffered bar's `t`.
   */
  appendBar(asset: Asset, bar: Bar): void {
    if (this.mode !== 'streaming') {
      throw new Error('appendBar is only valid in streaming mode');
    }
    const buf = this.streamingBars.get(asset.id) ?? [];
    const last = buf[buf.length - 1];
    if (last !== undefined && bar.t.getTime() <= last.t.getTime()) {
      throw new Error(
        `appendBar: bars must be in ascending t order; got ${bar.t.toISOString()} after ${last.t.toISOString()}`,
      );
    }
    buf.push(bar);
    this.streamingBars.set(asset.id, buf);
    // Invalidate cached series so next compute rebuilds from updated buffer.
    this.seriesCache.delete(asset.id);
  }

  private baseSeries(asset: Asset): Promise<Series> {
    const cached = this.seriesCache.get(asset.id);
    if (cached) return cached;

    let p: Promise<Series>;
    if (this.mode === 'streaming') {
      const buf = this.streamingBars.get(asset.id) ?? [];
      p = Promise.resolve(barsToSeries(buf, this.field));
    } else {
      // Historical mode: fetch from DataFeed and cache.
      p = (async () => {
        const bars = await collectBars(this.dataFeed.bars(asset, this.range!, this.freq));
        return barsToSeries(bars, this.field);
      })();
    }

    this.seriesCache.set(asset.id, p);
    return p;
  }

  private cacheKey(spec: FeatureSpec, asset: Asset): FeatureKey {
    return {
      feature: spec.kind,
      paramsHash: paramsHash(spec),
      scope: { kind: 'asset', asset: asset.id },
      range: this.mode === 'streaming' ? STREAMING_SENTINEL_RANGE : this.range!,
      freq: this.freq,
    };
  }

  /**
   * Computes (or retrieves from cache) the output `Series` for a given feature
   * spec applied to a specific asset.
   *
   * **Historical mode:** on the first call for a `(spec, asset)` pair:
   * 1. Fetches or reuses the in-memory base `Series` for the asset.
   * 2. Dispatches to the registered compute function for `spec.kind`.
   * 3. Stores the result in `featureCache`.
   *
   * **Streaming mode:** reads from the in-memory bar buffer populated via
   * `appendBar`. `DataFeed.bars` is never called. Cache keys use a sentinel
   * range to avoid collision with historical entries.
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
    const cached = await this.featureCache.get(key);
    if (cached) return cached;
    const base = await this.baseSeries(asset);
    const compute = getFeatureCompute(spec.kind);
    const result = compute(base, spec);
    await this.featureCache.set(key, result);
    return result;
  }
}
