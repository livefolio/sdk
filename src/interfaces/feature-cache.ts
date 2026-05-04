import type { AssetId, DateRange, Frequency, Series } from './types';

/**
 * Identifies what an indicator was computed over — either a single asset or
 * a whole universe.
 *
 * - `{ kind: 'asset'; asset: AssetId }` — the indicator was computed for a
 *   specific instrument (e.g. 20-day SMA for AAPL).
 * - `{ kind: 'universe'; universeHash: string }` — the indicator covers the
 *   full universe (e.g. cross-sectional momentum rank). `universeHash` is a
 *   content-hash of the sorted asset-id list so that cache keys survive
 *   universe reordering.
 */
export type FeatureScope = { kind: 'asset'; asset: AssetId } | { kind: 'universe'; universeHash: string };

/**
 * Content-addressed cache key for a feature computation result.
 *
 * Every field participates in key equality — changing any one of them
 * addresses a different cache entry. Use this type when building custom
 * {@link FeatureCache} implementations.
 *
 * @example
 * ```ts
 * import type { FeatureKey } from '@livefolio/sdk';
 *
 * const key: FeatureKey = {
 *   feature:    'sma',
 *   paramsHash: 'abc123',           // hash of { window: 20 }
 *   scope:      { kind: 'asset', asset: 'AAPL' },
 *   range:      { from: new Date('2024-01-01'), to: new Date('2025-01-01') },
 *   freq:       '1d',
 * };
 * ```
 */
export type FeatureKey = {
  /** Feature name, e.g. `'sma'`, `'rsi'`. */
  feature: string;
  /** Deterministic hash of the feature's parameter object. */
  paramsHash: string;
  /** Asset or universe this result covers. */
  scope: FeatureScope;
  /** The date range the cached series spans. */
  range: DateRange;
  /** Bar granularity used when computing the feature. */
  freq: Frequency;
};

/**
 * Content-addressed cache for feature computation results.
 *
 * Implementations MUST guarantee:
 * - `get` returns the exact `Series` previously stored under `key`, or
 *   `undefined` if no entry exists. It MUST NOT return a stale or partially
 *   overlapping series.
 * - `set` stores `series` under `key` and makes it immediately available to
 *   subsequent `get` calls.
 * - `invalidate` (optional) removes all entries whose key fields match the
 *   supplied `prefix`. Partial matches (specifying only `feature`, for example)
 *   MUST invalidate every key that shares those fields, regardless of the
 *   remaining fields.
 * - All methods are `async`; implementations backed by in-process Maps may
 *   resolve synchronously via `Promise.resolve`.
 *
 * Reference implementation: {@link MemoryFeatureCache} — in-process Map,
 * no eviction, suitable for single-run backtests.
 *
 * @example
 * ```ts
 * import { MemoryFeatureCache } from '@livefolio/sdk';
 * import type { FeatureKey, Series } from '@livefolio/sdk';
 *
 * const cache = new MemoryFeatureCache();
 * const key: FeatureKey = {
 *   feature:    'sma',
 *   paramsHash: 'abc123',
 *   scope:      { kind: 'asset', asset: 'AAPL' },
 *   range:      { from: new Date('2024-01-01'), to: new Date('2025-01-01') },
 *   freq:       '1d',
 * };
 * const series: Series = [{ t: new Date('2024-01-02'), v: 150.5 }];
 *
 * await cache.set(key, series);
 * const hit = await cache.get(key); // same reference
 * ```
 */
export interface FeatureCache {
  /**
   * Retrieves the cached {@link Series} for `key`, or `undefined` on a cache
   * miss.
   *
   * @param key - Fully-qualified cache key.
   * @returns The stored series, or `undefined` if not present.
   */
  get(key: FeatureKey): Promise<Series | undefined>;

  /**
   * Stores `series` under `key`. Overwrites any existing entry at that key.
   *
   * @param key    - Fully-qualified cache key.
   * @param series - The computed series to store. Must not be mutated after
   *   passing to `set`.
   */
  set(key: FeatureKey, series: Series): Promise<void>;

  /**
   * Removes all cache entries whose keys match the supplied `prefix`.
   * Optional — implementations that do not support invalidation may omit this.
   *
   * Matching is field-by-field: only the fields present in `prefix` are
   * compared; all others are treated as wildcards.
   *
   * @param prefix - Partial {@link FeatureKey}. Omitted fields match any value.
   */
  invalidate?(prefix: Partial<FeatureKey>): Promise<void>;
}
