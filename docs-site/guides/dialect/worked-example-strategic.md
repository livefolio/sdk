# Worked example: strategic dialect

> **Teaching code, not a production dialect.** The `strategic/v1` dialect sketched here does not ship in `@livefolio/sdk`. It is a minimal illustration of how to build a new dialect from scratch. Do not import it in production code.

The tactical dialect handles signal-driven rule trees. A *strategic* dialect is the opposite end of the spectrum: fixed weights, periodic rebalance, no feature computation, no rule tree. It is the simplest possible thing that justifies its own dialect — a 60/40 portfolio that rebalances monthly is a one-liner spec, not a five-node rule tree.

The runnable sample for this page is [`scripts/docs/guides-dialect/strategic-sketch.ts`](https://github.com/livefolio/sdk/blob/main/scripts/docs/guides-dialect/strategic-sketch.ts).

---

## The spec type

```ts
import type { AssetRef, AssetId, RebalanceFrequency } from '@livefolio/sdk';

type StrategicSpec = {
  kind: 'strategic/v1';
  universe: AssetRef[];
  weights: Record<AssetId, number>;
  rebalance: { frequency: 'Monthly' | 'Quarterly' };
};
```

Three fields:

- `universe` — the tradeable assets (same shape as `TacticalSpec.universe`, reused for familiarity).
- `weights` — fixed target allocations, keyed by `AssetId`. Must sum to ≤ 1.0; any remainder is held as cash.
- `rebalance` — how often to reconcile toward the fixed weights. Monthly and quarterly are the natural choices for a strategic (slow) rebalance; daily would be wasteful for fixed weights.

No `features` array, no `rules` tree. The weights are the entire decision.

---

## Validation

```ts
function validateStrategicSpec(spec: StrategicSpec): void {
  const universeIds = new Set(spec.universe.map((a) => a.id));

  for (const id of Object.keys(spec.weights)) {
    if (!universeIds.has(id as AssetId)) {
      throw new Error(
        `strategic/v1: weight references asset "${id}" not declared in universe`,
      );
    }
  }

  const total = Object.values(spec.weights).reduce((s, w) => s + w, 0);
  if (total > 1 + 1e-9) {
    throw new Error(
      `strategic/v1: weights sum to ${total.toFixed(4)}, must be ≤ 1.0`,
    );
  }
}
```

Two checks: universe coverage and weight normalization. The hydrator calls this before returning the `Strategy`, so bad specs fail early with a clear message.

---

## The hydrator

```ts
import type { Asset, AssetId, Calendar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';
import type { Strategy, Features } from '@livefolio/sdk';
import { reconcile, isRebalanceDay } from '@livefolio/sdk';

type StrategicFeatures = {
  prices: ReadonlyMap<AssetId, number>;
} & Features;

type FromStrategicSpecOptions = {
  calendar: Calendar;
  dataFeed: DataFeed;
  range: DateRange;
  freq: Frequency;
};

function fromStrategicSpec(
  spec: StrategicSpec,
  opts: FromStrategicSpecOptions,
): Strategy<StrategicFeatures> {
  validateStrategicSpec(spec);

  const universe: ReadonlyArray<Asset> = spec.universe.map((ref) => ({
    kind: 'equity' as const,
    id: ref.id,
    symbol: ref.symbol,
    ...(ref.exchange !== undefined ? { exchange: ref.exchange } : {}),
  }));

  const targets = new Map<AssetId, number>(
    Object.entries(spec.weights) as [AssetId, number][],
  );

  const cadence: RebalanceFrequency = spec.rebalance.frequency;

  return {
    universe: (_t, _portfolio) => universe,

    features: async (_universe, _portfolio, t) => {
      // Fetch the most recent closing price for each asset.
      const priceEntries = await Promise.all(
        universe.map(async (asset): Promise<[AssetId, number | undefined]> => {
          let last: number | undefined;
          for await (const bar of opts.dataFeed.bars(
            asset,
            { from: new Date(t.getTime() - 5 * 86_400_000), to: new Date(t.getTime() + 86_400_000) },
            opts.freq,
          )) {
            if (bar.t <= t) last = bar.close;
          }
          return [asset.id, last];
        }),
      );
      const prices = new Map<AssetId, number>();
      for (const [id, v] of priceEntries) {
        if (v !== undefined) prices.set(id, v);
      }
      return { prices };
    },

    build: (features, portfolio, t) => {
      if (!isRebalanceDay(t, cadence, opts.calendar)) return [];
      // Skip if any target asset has no price (e.g. pre-history warm-up).
      for (const id of targets.keys()) {
        if (!features.prices.has(id)) return [];
      }
      return reconcile(targets, portfolio, features.prices);
    },
  };
}
```

Key observations:

- `universe` is derived once at hydration time. It never changes — strategic dialects don't have dynamic universes.
- `features` fetches a small trailing window of bars and returns the most recent close for each asset. No indicator math needed.
- `build` gates on `isRebalanceDay`, then delegates to `reconcile`. The rule tree is replaced by a single `reconcile` call with fixed targets.
- The hydrator takes `calendar` and `dataFeed` as deps (not `FeatureRuntime`, since there are no indicators to memoize).

---

## Running a 60/40 SPY/IEF backtest

The full runnable sample is in `scripts/docs/guides-dialect/strategic-sketch.ts`. In summary:

```ts
const spec: StrategicSpec = {
  kind: 'strategic/v1',
  universe: [
    { id: 'us:SPY', symbol: 'SPY' },
    { id: 'us:IEF', symbol: 'IEF' },
  ],
  weights: { 'us:SPY': 0.6, 'us:IEF': 0.4 },
  rebalance: { frequency: 'Monthly' },
};

const strategy = fromStrategicSpec(spec, { calendar, dataFeed, range, freq: '1d' });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [] },
  dataFeed,
  executor,
  calendar,
});
```

The strategy rebalances at the last trading day of each calendar month (driven by `isRebalanceDay` with `'Monthly'`), targeting 60 % SPY and 40 % IEF. Between rebalance days, `build` returns `[]` — existing positions are held unchanged.

---

## What `tactical/v1` would look like for the same strategy

For comparison, the same 60/40 fixed-weight monthly rebalance expressed as a `tactical/v1` spec:

```ts
const equivalent: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [{ id: 'us:SPY', symbol: 'SPY' }, { id: 'us:IEF', symbol: 'IEF' }],
  rebalance: { frequency: 'Monthly' },
  features: [
    { id: '_noop', kind: 'price', asset: { id: 'us:SPY', symbol: 'SPY' } },
  ],
  rules: { op: 'allocate', weights: { 'us:SPY': 0.6, 'us:IEF': 0.4 } },
};
```

It works, but the `features` array is populated only to satisfy the type (the rule tree doesn't use any features). The `strategic/v1` dialect expresses the intent more clearly and skips the feature computation entirely. This is exactly the kind of semantic mismatch that justifies a new dialect.

---

## API reference

- [`Strategy`](/api/interfaces/Strategy) — the interface `fromStrategicSpec` returns.
- [`reconcile`](/api/functions/reconcile) — converts target weights to minimal order deltas.
- [`isRebalanceDay`](/api/functions/isRebalanceDay) — calendar-aware rebalance gate used in `build`.
- [`runBacktest`](/api/functions/runBacktest) — the runtime loop that drives the strategy.
