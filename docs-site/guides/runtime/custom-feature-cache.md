# Custom FeatureCache

A `FeatureCache` stores computed indicator series so they are not recalculated on every backtest run. The SDK ships with `MemoryFeatureCache` — a simple in-process `Map` with no eviction. For production deployments — cross-process sharing, persistence across runs, or TTL-based expiry — you write your own implementation. This page explains the interface, the content-addressing key scheme, and when and how to replace the default.

## Contract

The [`FeatureCache`](/api/interfaces/FeatureCache) interface has two required methods and one optional one:

```ts
interface FeatureCache {
  get(key: FeatureKey): Promise<Series | undefined>;
  set(key: FeatureKey, series: Series): Promise<void>;
  invalidate?(prefix: Partial<FeatureKey>): Promise<void>;
}
```

### `get(key)`

Returns the cached `Series` for the given key, or `undefined` on a miss. Always async — even an in-memory implementation must return a `Promise` so the interface is compatible with remote stores (Redis, a database, a filesystem) without requiring a different signature.

### `set(key, series)`

Stores a computed `Series`. Must be idempotent: calling `set` twice with the same key overwrites the previous value without error.

### `invalidate(prefix)` — optional

Removes all cache entries whose key matches all fields specified in `prefix`. A `Partial<FeatureKey>` with only `feature: 'sma'` set removes every SMA series regardless of asset or date range. Useful when you update an indicator's implementation and want to force recomputation. Omit this method when your store does not support prefix-based deletion.

## Content-addressed keys

Cache keys are [`FeatureKey`](/api/type-aliases/FeatureKey) objects with five fields:

```ts
type FeatureKey = {
  feature: string;      // indicator name, e.g. 'sma'
  paramsHash: string;   // stable hash of the indicator's parameters
  scope: FeatureScope;  // { kind: 'asset', asset: AssetId } | { kind: 'universe', ... }
  range: DateRange;     // the date window the series covers
  freq: Frequency;      // bar frequency, e.g. '1d'
};
```

The key is **content-addressed**: the same indicator with the same parameters computed over the same asset and date range always produces the same `FeatureKey`, regardless of which strategy triggered the computation. This means two different strategies using `sma(SPY, 50)` share a single cached series — there is no per-strategy cache namespace.

`MemoryFeatureCache` serialises the key to a pipe-delimited string for `Map` lookup. A Redis implementation would use the same serialisation as a key string. A filesystem implementation would hash the serialised key to a filename.

## When to write a custom cache

| Scenario | Recommended approach |
|---|---|
| Single-process backtest | Use `MemoryFeatureCache` (default) |
| Multiple backtest processes on the same machine | Filesystem cache keyed by the serialised `FeatureKey` |
| Distributed backtesting (multiple nodes) | Redis or Memcached with the serialised key |
| Long-running live strategy (persist across restarts) | SQLite or a hosted key-value store |
| Indicator data that expires (e.g. real-time feeds) | TTL-aware cache; implement `get` to check expiry before returning |

## Reference: `MemoryFeatureCache`

```ts
class MemoryFeatureCache implements FeatureCache {
  private store = new Map<string, Series>();

  async get(key: FeatureKey): Promise<Series | undefined> {
    return this.store.get(canonicalKey(key));
  }

  async set(key: FeatureKey, series: Series): Promise<void> {
    this.store.set(canonicalKey(key), series);
  }

  async invalidate(prefix: Partial<FeatureKey>): Promise<void> {
    const needles = canonicalPrefix(prefix).split('|').filter(Boolean);
    if (needles.length === 0) return;
    for (const k of [...this.store.keys()]) {
      if (needles.every(n => k.includes(n))) this.store.delete(k);
    }
  }
}
```

`canonicalKey` serialises all five fields into a deterministic pipe-delimited string. `invalidate` does a substring-based scan — fine for hundreds of entries, but consider a more efficient index for caches with thousands.

## Sample: `InstrumentedCache`

The sample at `scripts/docs/guides-runtime/custom-feature-cache.ts` wraps `MemoryFeatureCache` to track hit/miss rate:

```sh
npx tsx scripts/docs/guides-runtime/custom-feature-cache.ts
```

<<< @/../scripts/docs/guides-runtime/custom-feature-cache.ts

The `InstrumentedCache` class is the pattern to extend for any real backing store. Replace `MemoryFeatureCache` with a Redis client or SQLite adapter — the `get`/`set`/`invalidate` wrappers stay unchanged:

```ts
class RedisFeatureCache implements FeatureCache {
  constructor(private readonly redis: RedisClient) {}

  async get(key: FeatureKey): Promise<Series | undefined> {
    const raw = await this.redis.get(canonicalKey(key));
    return raw ? (JSON.parse(raw) as Series) : undefined;
  }

  async set(key: FeatureKey, series: Series): Promise<void> {
    await this.redis.set(canonicalKey(key), JSON.stringify(series));
  }

  async invalidate(prefix: Partial<FeatureKey>): Promise<void> {
    // Redis SCAN + DEL pattern for prefix matching.
    const pattern = `*${canonicalPrefix(prefix)}*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) await this.redis.del(...keys);
  }
}
```

You would need to copy (or extract) the `canonicalKey`/`canonicalPrefix` serialisation from `src/reference/memory-feature-cache.ts` for this to work correctly.

## Things to verify

- [ ] `get` returns `undefined` on a miss — not `null`, not an empty `Series`.
- [ ] `set` is idempotent: calling it twice with the same key leaves the cache consistent.
- [ ] `get` and `set` are both `async` and return `Promise` — even for synchronous in-memory stores.
- [ ] Key serialisation is deterministic: the same `FeatureKey` always produces the same canonical string.
- [ ] Your implementation compiles: `npm run docs:check`.
- [ ] Integration: run a backtest twice with a warm cache and confirm the second run makes zero `set` calls (all hits).

## What's next

- **DataFeed** — `FeatureRuntime` uses `FeatureCache` and `DataFeed` together. The cache sits in front of the feed; a miss triggers a `DataFeed.bars()` fetch. See [Custom DataFeed](./custom-data-feed).
- **`FeatureRuntime`** — the built-in runtime that wires `DataFeed`, `FeatureCache`, and indicator definitions together. Pass your custom cache to `new FeatureRuntime({ dataFeed, featureCache, range, freq })`.
- **API reference** — [`FeatureCache`](/api/interfaces/FeatureCache) · [`MemoryFeatureCache`](/api/classes/MemoryFeatureCache) · [`FeatureKey`](/api/type-aliases/FeatureKey).
