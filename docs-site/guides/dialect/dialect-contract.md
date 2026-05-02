# The dialect contract

A dialect is two things in code: a **spec type** (plain data, JSON-safe) and a **hydrator function** (`fromSpec`) that turns a spec into a `Strategy<F>` the runtime can drive. This page walks through the minimal skeleton, the `Strategy<F>` contract each hydrator must satisfy, and the validation pattern most dialects need.

For the complete worked example, see [Worked example: strategic dialect](/guides/dialect/worked-example-strategic). The sample for this page is [`scripts/docs/guides-dialect/contract-shape.ts`](https://github.com/livefolio/sdk/blob/main/scripts/docs/guides-dialect/contract-shape.ts).

---

## The skeleton

```ts
import type { Asset, AssetId } from '@livefolio/sdk';
import type { Strategy, Features } from '@livefolio/sdk';

// 1. The spec — plain data, no methods, JSON-serializable.
type MyDialectSpec = {
  kind: 'mydialect/v1';          // dialect identifier
  // ... your fields
};

// 2. The features bundle — what build() receives.
type MyFeatures = {
  prices: ReadonlyMap<AssetId, number>;
} & Features;

// 3. The hydrator — turns spec into a runnable Strategy.
function fromMyDialectSpec(spec: MyDialectSpec): Strategy<MyFeatures> {
  validate(spec);               // throw early on bad input
  return {
    universe: (_t, _portfolio) => [ /* assets derived from spec */ ],
    features: async (_universe, _portfolio, _t) => ({ prices: new Map() }),
    build: (_features, _portfolio, _t) => [],
  };
}
```

Three parts, always in this order:

| Part | What it is |
|---|---|
| Spec type | The data schema. Fields must be JSON-safe primitives, arrays, or records. No `Date`, no `Map`, no functions. |
| Features type | The bundle `features()` produces and `build()` consumes. Can hold `Map`s, typed sub-objects, anything TypeScript allows. |
| Hydrator | A plain function. May close over runtime deps (e.g. calendar, data feed) passed as a second argument. |

---

## The `Strategy<F>` contract

`Strategy<F>` has three methods. All three must be implemented by every hydrator.

```ts
interface Strategy<F extends Features> {
  universe(t: Date, portfolio: Portfolio): ReadonlyArray<Asset>;
  features(universe: ReadonlyArray<Asset>, portfolio: Portfolio, t: Date): F | Promise<F>;
  build(features: F, portfolio: Portfolio, t: Date): ReadonlyArray<Order>;
}
```

### `universe`

Returns the set of assets eligible for trading on date `t`. The runtime passes the result directly to `features` — whatever you return here is what `features` fetches data for.

Rules:
- Must be **synchronous and cheap**. No I/O.
- May return a dynamic subset based on `portfolio` (e.g. holdings filter, liquidity exclusion).
- May return an empty array; `build` will then receive empty prices and should return `[]`.

Typical implementation for spec-driven dialects: derive `Asset` descriptors from the spec's `universe` field and return them unchanged.

### `features`

Computes the feature snapshot for the current session. This is the only async step. The result is passed verbatim to `build`.

Rules:
- May be async — fetch prices, compute indicators, query external sources here.
- The `F` type parameter links `features` to `build`: TypeScript verifies the produced bundle matches what `build` consumes.
- If data is unavailable for a session (e.g. no bars), return a bundle that causes `build` to return `[]` rather than throwing.

### `build`

Translates the feature snapshot into orders. Must be **synchronous**.

Rules:
- Returning `[]` is valid and means "hold current positions unchanged".
- Use [`reconcile`](/api/functions/reconcile) to convert target weights into minimal order deltas.
- Gate on rebalance day inside `build` if the dialect has a non-daily cadence; `isRebalanceDay` is available for this.

---

## Validation

Most dialects need validation beyond what TypeScript enforces. Add a `validate` function called at the top of the hydrator:

```ts
function validate(spec: MyDialectSpec): void {
  // Cross-reference check: every ID referenced in weights must appear in universe.
  const universeIds = new Set(spec.universe.map((a) => a.id));
  for (const id of Object.keys(spec.weights)) {
    if (!universeIds.has(id as AssetId)) {
      throw new Error(
        `mydialect/v1: weight references asset "${id}" that is not declared in universe`,
      );
    }
  }

  // Weight normalization: weights must sum to ≤ 1.
  const total = Object.values(spec.weights).reduce((s, w) => s + w, 0);
  if (total > 1 + 1e-9) {
    throw new Error(
      `mydialect/v1: weights sum to ${total.toFixed(4)}, expected ≤ 1.0`,
    );
  }
}
```

Validation patterns to consider for most dialects:

- **Universe coverage** — every asset ID in weights/targets is declared in `universe`.
- **Weight normalization** — weights sum to at most 1.0 (or exactly 1.0 if your dialect requires full investment).
- **Required fields** — field combinations that TypeScript can't enforce (e.g. `period` is meaningless without an indicator kind that uses it).
- **Self-references** — a synthetic asset referencing itself as its underlying (this is what `tactical/v1` checks in `validateSynthetics`).

Throw `Error` with a message that starts with the dialect identifier (`mydialect/v1: ...`) so the caller knows which hydrator raised the error.

---

## Naming convention

The `kind` field is the dialect identifier. Follow the pattern established by `tactical/v1`:

```
<family>/<version>
```

- `family` — short, lowercase, no hyphens. Describes the strategy family: `tactical`, `strategic`, `riskparity`, `momentum`.
- `version` — integer, starting at `v1`. (`v0` is reserved for the pre-promotion iteration; see [Versioning](/guides/dialect/versioning).)

Examples: `tactical/v1`, `strategic/v1`, `riskparity/v2`, `xs-momentum/v1`.

The `kind` string travels with the spec in storage. It is the key the runtime uses to dispatch to the right hydrator, so treat it as a stable public identifier from the moment the first spec is stored.

---

## Minimal sample

The sample in [`scripts/docs/guides-dialect/contract-shape.ts`](https://github.com/livefolio/sdk/blob/main/scripts/docs/guides-dialect/contract-shape.ts) shows a complete minimal `MyDialectSpec` with one field, a validator, and a `fromMyDialectSpec` hydrator that returns a degenerate `Strategy` (always returns 100 % cash — no orders). The point is the shape, not a useful strategy.

---

## API reference

- [`Strategy`](/api/interfaces/Strategy) — the interface every hydrator must return.
- [`TacticalSpec`](/api/type-aliases/TacticalSpec) — the reference dialect's spec type.
- [`reconcile`](/api/functions/reconcile) — converts target weights to order deltas.
- [`isRebalanceDay`](/api/functions/isRebalanceDay) — calendar-aware rebalance gate.
