# Parity guarantee

The parity gate is a regression test that proves v0.4 is not a rewrite that drifts from v0.3's allocation behavior. It does this by running both engines over the same strategy and the same data, then asserting that their target weights agree to floating-point tolerance on every comparable trading day.

For the full methodology and divergence spec, see `docs/specs/2026-05-02-v0.4-parity-divergences.md` in the repository.

---

## What the test proves

The canonical parity strategy is a weekly trend-following allocation across SPY, QQQ, and IEF — three assets, an SMA200 trend filter on each, a rule tree that switches between growth and defensive branches, weekly rebalance cadence. This is the same strategy shape that typical v0.3 SDK users built: multi-asset, indicator-driven, rule-based.

The parity gate runs both engines against ~5.5 years of yfinance fixture data (2020-10 through 2026-05, after warmup) and asserts:

- The set of rebalance dates where each engine emits a target is identical.
- On every such date, the per-asset target weights agree to within `1e-6`.
- The matched cell count is greater than zero (the test is not vacuously passing on an empty comparison set).

Passing this gate means: any v0.3 strategy that maps cleanly onto a `TacticalSpec` will produce the same target weights in v0.4 that it produced in v0.3. The v0.4 rollout cannot silently break allocation behavior.

---

## Methodology: TARGET-vs-TARGET

The comparison is on **target weights**, not on realized portfolio weights. This distinction matters.

Realized portfolio weights drift between rebalances as prices move. If SPY rallies 5% while QQQ is flat in the week after a rebalance, the realized weights will have drifted away from target before the next rebalance fires — and they will differ between any two engines that don't share an identical fill model. Comparing realized weights against each other would generate spurious diffs that say nothing about whether the rule-tree logic agrees.

Target weights are different. Both engines re-evaluate the same rule tree with the same feature values to produce the same intended allocation. Comparing targets isolates the rule-tree semantics from execution-time effects and fill-price conventions.

**v0.3 side:** `evaluateStrategy` carries the last rebalance target forward across non-rebalance days, so `bar.allocation.holdings` is the target on every trading day. The parity extractor reads this directly.

**v0.4 side:** a separate extractor re-evaluates the rule tree at each snapshot date using `evaluateRuleTree` and `evaluateFeatureSpecs`. On rebalance days it computes a fresh target; on non-rebalance days it carries the last target forward — matching v0.3's semantics.

---

## Allowance 1: SMA200 warmup window

v0.3 and v0.4 handle a missing feature value differently at startup, before the SMA200 has enough history to produce a value.

v0.3 coerces an undefined signal to `false`, causing the trend rule's condition to fail and evaluation to fall through to the catch-all defensive branch (`IEF = 1`). The strategy emits a target from day one, but the target is the defensive allocation, not a genuine trend evaluation.

v0.4 treats an undefined feature as a hard skip: when any required feature lacks a value at time `t`, the strategy emits no target and takes no action. This is the more conservative and arguably more correct behavior — the strategy has not yet seen enough data to make a trend call.

These behaviors agree on nothing during the warmup window (roughly 2020-06 through 2020-10 for an SMA200 starting from the fixture's beginning). The parity gate resolves this by clipping the comparison range: `compareFrom` is set to the first date where v0.4 emits a non-empty target. Days strictly before that are excluded from both sides. The comparison begins where both engines are genuinely operating in steady state.

---

## Allowance 2: Fixture upper-bound clip

v0.3 is bar-driven: it iterates the fixture's actual bars and stops when they run out. v0.4 is calendar-driven: `NYSEExchangeCalendar` schedules sessions up to `PARITY_RANGE.to`, and the test's `priceAt` fallback returns the last close for any date beyond the fixture's last bar. If `PARITY_RANGE.to` falls past the fixture's last date, v0.4 would generate additional snapshots at stale prices that v0.3 never sees.

The fix is a range clip: `compareTo = min(v3Last, v4Last)`. Dates after the earlier of the two last-bar dates are excluded from both sides.

As of the 2026-05 fixture refresh, `PARITY_RANGE.to` is a Saturday and the fixture's last bar is the preceding Friday — the calendar emits no session for the Saturday, and the clip is currently a no-op. The guard remains because it will engage again the next time the fixture range is extended.

---

## The promise

After applying the two allowances, on the resulting intersection of dates:

- v0.4 produces identical target weights to v0.3 on the canonical SPY/QQQ/IEF strategy across ~5.5 years of yfinance fixture data.
- This holds to floating-point tolerance (`1e-6` per weight per date).

The promise generalizes: any v0.3 → v0.4 port that expresses the same rule-tree behavior via `TacticalSpec` will produce the same target weights. The parity gate is the load-bearing proof for the v0.4 rollout.

---

## The constraint: target weights, not realized portfolio

The guarantee is deliberately scoped to **target weights**. Realized portfolio values can and will diverge between rebalances as prices move — that is not a bug, it is the expected behavior of a portfolio that is not continuously rebalanced. A v0.3 backtest and a v0.4 backtest run over the same dates will show different realized weights between rebalance events because both are simulating a portfolio evolving at market prices.

If you are comparing cumulative returns or drawdown statistics between v0.3 and v0.4, small numerical differences are expected and acceptable. If you are comparing target weights on rebalance days, the gate guarantees they agree.
