---
name: livefolio-debug-strategy
description: Use when investigating unexpected output from a @livefolio/sdk strategy or backtest — empty snapshots, no rebalances, wrong allocations, parity-test diffs, NaN positions, or "the strategy holds defensive forever". Triggers on debugging questions about runBacktest, fromSpec, or TacticalSpec behavior.
---

# Debugging a misbehaving strategy

Most strategy bugs in `@livefolio/sdk` cluster into a few patterns. Walk this checklist before pulling out the debugger.

## Symptom → likely cause

### "runBacktest returns empty / very few snapshots"

- **Range too narrow.** `runBacktest`'s `range` is what determines snapshots. Confirm `range.from < range.to` and both fall on calendar sessions (or that the calendar has sessions in between).
- **Calendar mismatch.** Using `LSEExchangeCalendar` with US-listed tickers will produce sessions on UK trading days but your DataFeed may not have bars for US holidays the LSE calendar doesn't know about. Match the calendar to the asset listing.
- **DataFeed empty.** Stub or mock the DataFeed and assert it actually returns bars for `range`. A silent empty AsyncIterable means zero snapshots.

### "Strategy never rebalances / always holds defensive"

- **Feature warmup window.** SMA(200) needs 200 prior bars before it emits a value. Until then, every comparison referencing `sma200` is **undefined**, and `fromSpec` returns no orders (NOT a fallback — see next bullet). Extend `range.from` backwards by ≥ `period` trading days, or shorten the indicator period.
- **`fromSpec` skip vs v0.3 fallthrough.** v0.3 (`evaluateStrategy`) coerces undefined feature values to `false`, so an `if cond` on undefined fires the `else` branch. v0.4 (`fromSpec`) returns `[]` orders entirely when any feature is undefined — no allocation gets emitted. If you want the v0.3 behavior, structure the rule tree to handle the case explicitly.
- **Rebalance schedule miscount.** `rebalance.frequency: 'Weekly'` rebalances on the first session of each week. If your range starts mid-week, the first rebalance is the next week's open, not day 1.

### "Allocations look wrong / weights don't sum to 1"

- **Weight key typo.** `weights: { 'us:SPY': 0.6, 'us:QQ': 0.4 }` (typo on QQQ) silently drops the unknown key. Check `Object.keys(weights)` matches `universe.map(u => u.id)`.
- **Reconcile not normalizing.** `reconcile()` normalizes input weights to sum to 1 — but if a weight is negative, the math goes weird. Validate weights non-negative before passing.
- **Stale snapshot in the wrong place.** `result.snapshots[i].portfolio` is the **post-fill** state of session `i`. The orders for session `i` are computed from session `i-1`'s portfolio. Don't compare `snapshot.portfolio` with `snapshot.orders` directly — the orders haven't been applied yet at order-emit time.

### "Hysteresis isn't working — strategy whipsaws"

- **Missing `Comparison.id`.** Without an `id`, `evaluateRuleTree` has no key to thread previous-state into. Set a unique `id` on every comparison that uses `tolerance`.
- **Tolerance too small.** A `tolerance: 0.001` (10 bps) rarely does anything for a price/MA crossover that moves 1-2% per day. Try `0.01` or `0.02` and see if whipsaw drops.
- **State not persisting between calls.** `fromSpec` threads state through a closure. If you call `fromSpec` fresh on every session (instead of once at the start), state resets every time. Hydrate once outside the loop.

### "Parity test fails after a refactor"

- **Methodology is TARGET-vs-TARGET.** The parity gate compares rule-tree targets, not realized weights. If your refactor changed indicator math (e.g. SMA period, a hidden `+1` somewhere), you'll see diffs. Check the indicator first.
- **Range alignment.** v0.3 is bar-driven; v0.4 is calendar-driven. Calendar changes (NYSE half-day handling, weekmask era boundary) can shift `compareTo`. See `docs/specs/2026-05-02-v0.4-parity-divergences.md`.
- **Feature-undefined coercion.** Same root cause as the "always holds defensive" symptom above. Read the divergences spec for the codified allowance.

### "Live mode (`runLive`) misbehaves"

- **Stale features in `mark`/`snapshot` events.** Almost always: the `fromSpec` strategy's `features` closure captured a different `FeatureRuntime` than `runLive` is feeding. Fix: build one `FeatureRuntime` in `'streaming'` mode (`new FeatureRuntime({ ..., mode: 'streaming', initialBars: result.bars })`) and pass the **same instance** to both `fromSpec({ runtime, calendar })` and `runLive(result, { streamingRuntime, ... })`.
- **Duplicate first `snapshot` after replay-then-stream handoff.** This was a bug fixed during Phase 9 — `currentSession` at startup must be `calendar.next(history.lastSnapshot.t)`, NOT `lastSnapshot.t` itself. If you see the last backtest snapshot replayed as the first live snapshot, regression check that logic.
- **State doesn't carry from backtest into live.** `runLive` seeds from `result.finalState`; if it's `undefined`, your strategy probably returned bare `Order[]` from `build` instead of `{ orders, state }`. For `fromSpec` strategies, this happens automatically. For handcrafted strategies, ensure `initialState()` is defined and `build` returns the state-threaded shape.
- **Preview-build throws "could not be cloned".** `runLive` runs `strategy.build` against a `structuredClone(state)` per tick to compute `previewOrders` without corrupting committed state. If state contains non-cloneable values (functions, class instances with private fields, DOM nodes), `structuredClone` throws. Keep state JSON-shaped.
- **`runLive` never emits a `snapshot`.** Calendar mismatch — your `StreamingDataFeed` ticks are timestamped with `t` values that never cross a `calendar.next(currentSession)` boundary. Cross-check the calendar (Crypto24x7? NYSE?) against the tick timestamps.

### "NaN positions / cash"

- **Synthetic asset misconfiguration.** `SyntheticAsset.expense` is a **decimal** (0.0095 for 95 bps), not a percent. A 95 instead of 0.0095 produces astronomical drag.
- **Leverage out of range.** `leverage: 100` (you meant 1.0) blows up after a few sessions.
- **Bar with NaN OHLC.** Some DataFeed adapters silently emit NaN on bad data. Filter at the adapter layer, not in the strategy.

## Diagnostic snippets

**Inspect what features were emitted on a date:**

```ts
const features = await runtime.evaluateAll(spec.features, t);
console.log(Object.fromEntries(features));
```

**Count rebalances:**

```ts
const rebalances = result.snapshots.filter(s => s.orders.length > 0).length;
```

**See the first 5 snapshots:**

```ts
for (const s of result.snapshots.slice(0, 5)) {
  console.log(s.t.toISOString(), 'orders:', s.orders.length, 'cash:', s.portfolio.cash);
}
```

**Verify the rule tree sees what you expect:**

```ts
const values = await evaluateFeatureSpecs(spec.features, runtime, t);
const { weights } = evaluateRuleTree(spec.rules, values);
console.log({ values: Object.fromEntries(values), weights });
```

## When stuck

- Run the docs-site recipes and compare your spec shape to the closest one (`/recipes/multi-asset-trend`, `/recipes/mean-reversion`, etc.).
- Re-read the contract: [`/api/interfaces/Strategy`](../../docs-site/api/interfaces/Strategy.md), [`/api/functions/runBacktest`](../../docs-site/api/functions/runBacktest.md).
- Drop into `parity/src/parity.test.ts` for a working end-to-end reference.
