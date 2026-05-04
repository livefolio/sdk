# When to write a dialect

A *dialect* is a JSON-friendly spec type paired with a hydrator function that turns the spec into a `Strategy<F>` the runtime can drive. The `tactical/v1` dialect that ships with `@livefolio/sdk` is the canonical example: the spec is plain data (`TacticalSpec`), the hydrator is `fromSpec`, and the output is a `Strategy<TacticalFeatures>` that `runBacktest` consumes. This page helps you decide whether you need a dialect, and if so, what kind.

---

## Decision tree

```
Do you need to store or transmit the strategy definition as data?
│
├── No → Write a hand-coded Strategy<F>
│         (full TypeScript power, not serializable, fine for one-offs)
│
└── Yes
    │
    Do many authors create strategies of the same shape?
    │
    ├── No → Consider a data-driven hand-coded Strategy<F>
    │         (e.g. a factory function that accepts a config object,
    │          not a full dialect — avoids the versioning overhead)
    │
    └── Yes
        │
        Does an existing dialect (e.g. tactical/v1) cover the shape?
        │
        ├── Yes → Use that dialect, or extend it (see below)
        │
        └── No → Write a new dialect
```

---

## When a hand-coded `Strategy<F>` is the right answer

Implement `Strategy<F>` directly in TypeScript when:

- The strategy is **one-off** — no one else needs to author the same shape.
- The decision logic is **too dynamic for a fixed spec** — e.g. it reads from a live signal feed, branches on runtime config, or calls external APIs inside `features()`.
- You want **full code freedom** — custom feature math, multi-leg order construction, or direct control over rebalance timing not covered by any existing dialect.
- The strategy will **never be serialized** — it lives entirely in code and is deployed as a module.

A factory function (a plain TypeScript function that closes over config and returns a `Strategy<F>`) is the simplest way to parameterize a hand-coded strategy without the overhead of a dialect. Reserve dialects for the case where you need the spec to be data.

---

## When to write a dialect

Write a new dialect when all of the following hold:

1. **Multiple authors** will create strategies of the same shape, and you want them working in a shared, validated format rather than hand-rolling separate implementations.
2. **The spec must be data** — stored in a database, transmitted over an API, rendered in a UI, or version-controlled as JSON/YAML.
3. **The spec has a fixed schema** — a dialect is intentionally not Turing-complete. If the strategy logic can escape the schema, it's no longer a dialect, it's a scripting engine.
4. **Hosted-product or multi-tenant compatibility** — if strategies will be evaluated by a runtime you don't control (e.g. a SaaS scheduler), the serialized spec is the handshake. The hydrator lives in the SDK; the spec travels separately.

Real-world signals: you are building a strategy builder UI, a strategy registry, or a hosted backtester that runs arbitrary user strategies.

---

## When to extend `tactical/v1` instead of writing a new dialect

Extending the existing `tactical/v1` dialect is often preferable to writing a new one. Extend `tactical/v1` when:

- The new capability fits the existing shape — a **new feature kind** (e.g. `'atr'`, `'bollinger'`), a new **comparison operator**, or a new **rebalance frequency**.
- The change is **additive** (new optional field with a sensible default) — existing specs remain valid without modification.
- The semantic model — *universe + features + rule tree → target weights* — is unchanged.

Extending means adding a new variant to the `TacticalFeatureSpec` union or a new value to an existing enum, then bumping the `TacticalSpec` type to `tactical/v2` only when the change breaks existing serialized specs. See Versioning and deprecation (coming soon) for the promotion story.

Write a **new** dialect instead when the semantic model itself is different: no rule tree (strategic), no per-asset features (risk-parity), no universe (fixed-weight glide path), etc.

---

## What's next

- [The dialect contract](/guides/dialect/dialect-contract) — the `Spec + fromSpec` skeleton and what each part must do.
- Versioning and deprecation — how to evolve a dialect without breaking stored specs. (coming soon)
- Worked example: strategic dialect — a concrete minimal dialect from scratch. (coming soon)
