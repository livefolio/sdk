---
name: livefolio-tactical-author
description: Use when authoring or modifying a TacticalSpec for @livefolio/sdk — building tactical allocation strategies, configuring rule trees with hysteresis, declaring synthetic assets, or wiring features. Triggers on tactical/v1 spec work, fromSpec calls, mentions of "tactical strategy", "rule tree", "rebalance schedule", or imports from @livefolio/sdk that include TacticalSpec / fromSpec.
---

# Authoring a TacticalSpec

`TacticalSpec` is the JSON-shaped strategy declaration that `tactical.fromSpec` hydrates into a runnable `Strategy<F, S>` (state-threaded; `S` is `RuleTreeState` for hysteresis). Same shape, every time. Get the shape right; the runtime takes care of execution.

## Spec skeleton

```ts
const spec: TacticalSpec = {
  kind: 'tactical/v1',                    // never v0 — v0 warns and is deprecated
  universe: [{ id: 'us:SPY', symbol: 'SPY' }, ...],
  rebalance: { frequency: 'Weekly' },     // 'Daily' | 'Weekly' | 'Monthly'
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma100', kind: 'sma', asset: SPY, period: 100 },
    // optional: delay (positional shift, integer), 6 indicator kinds available
  ],
  rules: { /* RuleNode tree */ },
};
```

## Validation checklist (run mentally before declaring it done)

- [ ] `kind === 'tactical/v1'` (NOT `tactical/v0` — that path emits a deprecation warning).
- [ ] Every `feature.id` is unique within the `features` array.
- [ ] Every `Comparison.id` in the rule tree is unique within the spec (used as hysteresis state key).
- [ ] Every `{ ref: 'foo' }` in the rule tree resolves to a `feature.id` declared in `features`.
- [ ] Every weight key in `op: 'allocate'` nodes is an `AssetId` present in `universe` (or in `synthetics`).
- [ ] Within a single `allocate` node, weights are non-negative and **sum to 1.0** (the runtime normalizes but unintended drift is a smell).
- [ ] Every `Comparison.tolerance` is a non-negative number (units are signal-relative; `0.01` means a 1% band on a price/MA ratio).
- [ ] Every `SyntheticAsset.expense` is a **decimal** (`0.0095` for 95 bps), NOT a percent. Same for any leverage.
- [ ] Every `SyntheticAsset.leverage` is reasonable (typically 1.0–3.0; document the bound if it exceeds 3).
- [ ] `rebalance.frequency` matches the spec's intent — "Daily" creates a lot of turnover.

## Common patterns

**Rebalance gate.** `fromSpec` only re-evaluates the rule tree on `isRebalanceDay(t, rebalance)`. Between rebalances, last targets carry forward. If the runtime calls `build()` on a non-rebalance day, no orders are emitted.

**Hysteresis.** Set `Comparison.id` to thread state across rebalances; set `Comparison.tolerance` to a band width. A signal that crosses the threshold inside the band keeps the previous side; only a clean break flips. Use this on noisy signals (price/MA ratios near 1.0).

**Synthetics for leverage.** Declare `SyntheticAsset` to model leveraged ETFs without using a real ticker (`{ id: 'syn:SPY_2x', baseAsset: SPY, leverage: 2.0, expense: 0.0095 }`). Math: daily-reset leverage compounding × `(1 - expense/252)`.

**Defensive fallback.** Wrap rule trees in `if/else` with an `else` branch allocating to a defensive asset (cash via `IEF` or similar). Strategies that emit no allocation on undefined features simply hold last targets — explicit fallback is clearer.

## State-threaded Strategy API (Phase 9)

`fromSpec` now returns a `Strategy<TacticalFeatures, RuleTreeState>` — state is threaded explicitly through `runBacktest`/`runLive` rather than living in the closure. **Spec authors don't need to do anything different**: `fromSpec(spec, { runtime, calendar })` still produces the strategy, and `runBacktest({ strategy, ... })` still drives it; the state plumbing is internal to `fromSpec`.

If you handcraft a custom `Strategy` alongside `fromSpec`:
- Implement optional `initialState?(): S` to seed the first session.
- `build(features, portfolio, t, state)` takes `state: S` as the new fourth argument and may return either a bare `ReadonlyArray<Order>` (legacy, equivalent to `S = void`) or `{ orders, state }` to advance state.
- This is the API `runBacktest` uses to thread `finalState` into `BacktestResult`, which `runLive` then consumes to continue uninterrupted.

For live evaluation of a `fromSpec` strategy, see `docs-site/recipes/replay-then-stream.md` and `docs/specs/2026-05-02-v0.4-phase-9-streaming-design.md`. The key gotcha: pass an explicit `streamingRuntime: FeatureRuntime` (built in `'streaming'` mode with `initialBars: result.bars`) to **both** `fromSpec` AND `runLive` so the `features` closure inside the strategy captures the same runtime that `runLive` is feeding live ticks into.

## When in doubt

- Read [`docs/specs/2026-04-29-v0.4-multi-repo-interface-design.md`](../../docs/specs/2026-04-29-v0.4-multi-repo-interface-design.md) for the dialect's design rationale.
- Use `parity/src/strategy.ts` (the canonical PARITY_SPEC) as a worked example — SPY/QQQ/IEF weekly trend.
- Full guide: see the docs site `/guides/authoring/anatomy-of-a-tactical-spec` and `/guides/authoring/rule-trees`.

## Pre-ship verification

```bash
npx tsc --noEmit                   # types resolve
npx tsx your-strategy.ts           # runs end-to-end with a backtest
```

If you wire it through `runBacktest` and see zero rebalances, the feature warmup window probably starts after your range — extend the range or use a shorter `period`.
