# Feature cache and content addressing

The SDK's feature layer computes indicators — SMA, RSI, return series, volatility, drawdown — on demand and memoizes the results. The memoization is *content-addressed*: a cache key is derived entirely from the logical content of the computation, not from where or when the computation was requested. Two separate strategies, two separate backtests, or a backtest and a live run all share the same cache entries for identical computations.

---

## What "content-addressed" means here

A traditional cache key might be a string like `"my-strategy-sma-spy-20"` or a UUID assigned at feature registration time. Such keys are *identity-addressed*: they point to a specific object instance, not to the logical computation.

Content-addressing flips the question: instead of "which object computed this?", the key encodes "what was computed?" — the feature kind, all its parameters, the asset, and the date range. Any two specs that are logically equivalent — same `kind`, same parameter values, same asset — produce the same key, regardless of which strategy defined them, which `FeatureRuntime` instance evaluated them, or what order the spec object's properties were inserted.

The practical result: if your equity trend strategy and your risk-parity strategy both use `{ kind: 'sma', period: 200 }` on `SPY`, only one computation runs. Subsequent calls hit the cache.

---

## The `FeatureKey` shape

A `FeatureKey` has five fields:

```
{
  feature:     string      // the indicator name, e.g. "sma"
  paramsHash:  string      // content hash of the spec's parameters
  asset:       AssetId     // the target asset, e.g. "SPY"
  from:        string      // ISO date, inclusive start of the computed range
  freq:        Frequency   // bar granularity, e.g. "1d"
}
```

`feature` is the `kind` field of the `FeatureSpec` (`'sma'`, `'ema'`, `'rsi'`, `'return'`, `'volatility'`, `'drawdown'`, `'price'`). `paramsHash` captures everything else that varies within that kind.

See [`FeatureKey`](/api/type-aliases/FeatureKey) and [`FeatureSpec`](/api/type-aliases/FeatureSpec).

---

## How `paramsHash` works

`paramsHash` is a deterministic string derived from the spec object's logical content. The algorithm:

1. Recursively sort the spec object's keys alphabetically.
2. Drop any `undefined` values (treating an omitted optional field as identical to an explicitly-undefined one).
3. `JSON.stringify` the result.

Because the output is sorted and normalized, `{ kind: 'return', period: 10 }` and `{ kind: 'return', period: 10, mode: undefined }` produce the same hash: `'{"kind":"return","period":10}'`. The cache therefore correctly treats both as the same computation.

The current encoding is `JSON.stringify` of the sorted, normalized spec. The contract is *same logical content → same string*; the encoding itself is an implementation detail and may migrate to SHA-256 in a future version without breaking the cache interface.

See [`paramsHash`](/api/functions/paramsHash).

---

## Why it matters

**Cross-strategy reuse.** A shared `FeatureCache` instance across multiple strategies means any indicator computed for strategy A is available for strategy B at no cost. This is especially valuable in multi-strategy portfolios where overlapping universe and features are common.

**Cross-run continuity.** If you run a backtest over 2020–2024 and later extend it to 2025, the cache already holds every indicator value from the original range. Only the incremental bars need computation. With a persistent backend, this works across process restarts too.

**Backtest ↔ live parity.** The same `FeatureKey` is used whether `runBacktest` is running a simulation or a live evaluation loop. A persistent cache seeded from a backtest can warm a live run from day one.

**Testability.** Because cache keys are deterministic and human-readable, you can pre-populate a `MemoryFeatureCache` with known values in a unit test and verify rule-tree behavior without touching `DataFeed` at all.

---

## Reference implementation: `MemoryFeatureCache`

`MemoryFeatureCache` is the default implementation shipped in the SDK. It stores values in a `Map` keyed by a serialized `FeatureKey`. It is in-process and has no eviction policy — appropriate for single-run backtests on a laptop where the full indicator series fits in memory.

For cross-process or persistent caching — Redis, DynamoDB, Postgres, S3 — implement the `FeatureCache` interface with your preferred store. The `FeatureKey` serializes cleanly to a string for use as a store key.

See [`MemoryFeatureCache`](/api/classes/MemoryFeatureCache), [`FeatureCache`](/api/interfaces/FeatureCache).

For a walkthrough of implementing a persistent cache, see the Custom FeatureCache guide (coming soon).
