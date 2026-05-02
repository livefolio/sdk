# Versioning and deprecation

A dialect spec is public API the moment the first spec is serialized. Strategy specs can live in databases, version-controlled files, or hosted products for years. This page documents how to evolve a dialect without invalidating stored specs, using the `tactical/v0` → `tactical/v1` promotion story from the SDK itself as the concrete example.

---

## The `tactical/v0` → `tactical/v1` story

`tactical/v1` was not the first version shipped internally. During development, the dialect was stamped `tactical/v0`. Once it passed the parity validation gate (v0.4 allocation history matches v0.3 bar-for-bar), it was promoted to `tactical/v1` — the stable public identifier.

The two are byte-for-byte identical in behavior. The spec type union accepts both:

```ts
type TacticalSpec = {
  kind: 'tactical/v0' | 'tactical/v1';
  // ... identical fields
};
```

The hydrator (`fromSpec`) handles the difference with a one-time deprecation warning:

```ts
let _warnedV0 = false;

export function fromSpec(spec: TacticalSpec, opts: FromSpecOptions): Strategy<TacticalFeatures> {
  if (spec.kind === 'tactical/v0' && !_warnedV0) {
    _warnedV0 = true;
    console.warn(
      '[@livefolio/sdk] tactical/v0 is deprecated; migrate to tactical/v1. ' +
        'The two are byte-for-byte equivalent. This warning fires once per process.',
    );
  }
  // ... rest of hydration
}
```

Key properties of this pattern:

- **Old specs still work** — no stored `tactical/v0` spec breaks.
- **Warning is once-per-process** — noisy enough to prompt migration, quiet enough not to spam production logs.
- **No behavioral difference** — users can mechanically rename `kind` to fix the warning, no other changes needed.

Apply the same pattern when you deprecate a `v0` iteration of your own dialect.

---

## When to bump major (new dialect version)

Bump `mydialect/v1` → `mydialect/v2` when a spec change **breaks an existing stored spec**:

- **Field renamed** — `weights` → `targets`. Old specs use the old name; the hydrator can't transparently migrate without guessing intent.
- **Field type changed** — e.g. `rebalance: 'Monthly'` (string) becomes `rebalance: { frequency: 'Monthly' }` (object).
- **Required field added** — old specs lack the field; a default can paper over this, but if the default would silently change behavior, a major bump is safer.
- **Field removed** — old specs carry the field; the hydrator would ignore it silently, which is usually acceptable, but if the removed field *was the activation condition* for behavior that disappears, it's a breaking change.

A major bump means writing a new type (`MyDialectV2Spec`), a new hydrator (`fromMyDialectV2Spec`), and keeping the old hydrator alive behind its old `kind` string for at least one deprecation window.

---

## When to bump minor (additive change)

An **additive optional field** with a sensible default is a minor change. Existing specs remain valid; the hydrator reads the field and falls back to the default when absent.

Example from the SDK design doc (§ "OHLCV field selection"):

> For v0.4, single-input indicators are close-only with no field parameter. When a real use case lands, adding `field?: 'open' | 'high' | 'low' | 'close' | 'volume'` is additive (optional, defaults to `'close'`, minor version bump) and FeatureCache-safe (`paramsHash` already keys by params).

The pattern:

```ts
// v1 spec — field didn't exist
type TacticalFeatureSpecSma_v1 = {
  id: string;
  kind: 'sma';
  asset: AssetRef;
  period: number;
  delay?: number;
  // field?: 'open' | 'high' | 'low' | 'close' | 'volume'; ← added in minor
};
```

Adding the `field` property is safe because:

1. Old specs that lack `field` get the default (`'close'`) — identical behavior to before.
2. New specs that set `field: 'high'` opt into the new behavior.
3. No stored spec breaks.

The `kind` string stays `tactical/v1`. Document the new field in the changelog.

---

## The deprecation path

Follow this two-step path when retiring an old `kind`:

### Step 1 — warn on old kind (one minor version)

Accept the old `kind`, run identical behavior, emit a one-time warning:

```ts
if (spec.kind === 'mydialect/v0' && !_warnedV0) {
  _warnedV0 = true;
  console.warn('mydialect/v0 is deprecated. Rename kind to "mydialect/v1". No other changes needed.');
}
```

Keep both `kind` values in the union:

```ts
type MyDialectSpec = {
  kind: 'mydialect/v0' | 'mydialect/v1';
  // ...
};
```

### Step 2 — remove old kind (next major SDK version)

Drop `'mydialect/v0'` from the union. The hydrator throws a helpful error for unknown kinds rather than silently ignoring them:

```ts
if (spec.kind !== 'mydialect/v1') {
  throw new Error(`Unsupported dialect kind: "${spec.kind}". Expected "mydialect/v1".`);
}
```

Update stored specs before the major bump. If your dialect is used in a hosted product, a migration script should scan the spec registry and rewrite the `kind` field.

---

## Across-the-board rules

| Change | Semver impact | Strategy |
|---|---|---|
| New optional field, sensible default | Minor | Add field, document default, no kind bump |
| New required field | Major | New `kind`, keep old hydrator behind old `kind` with warning |
| Rename or remove field | Major | New `kind`, keep old hydrator behind old `kind` with warning |
| New indicator kind (additive union variant) | Minor | Extend the union, no kind bump |
| Behavioral change in existing field | Major | New `kind`, document migration |
| v0 promoted to v1 (stability milestone) | Patch/no-op | Warn on `v0`, accept both |

---

## What's next

- [Worked example: strategic dialect](/guides/dialect/worked-example-strategic) — a concrete new dialect from scratch, showing how a `v1` kind is chosen from the start.
- [The dialect contract](/guides/dialect/dialect-contract) — spec type + hydrator skeleton.
