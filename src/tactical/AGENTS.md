<!-- Parent: ../AGENTS.md -->

# src/tactical

## Purpose
The `tactical/v1` dialect: declarative strategies as `TacticalSpec` objects, plus the machinery to hydrate them into runnable `Strategy<F>` values. `fromSpec` is the public entry point. The rule-tree evaluator (`evaluateRuleTree`), feature-spec evaluator (`evaluateFeatureSpecs`), and synthetic-asset wrapper (`withSynthetics`) are the building blocks.

## Key Files

| File | Description |
|------|-------------|
| `types.ts` | `TacticalSpec`, `RuleNode`, `Comparison`, `AssetRef`, `SyntheticAsset`, `RebalanceConfig`, etc. |
| `from-spec.ts` | `fromSpec(spec, { runtime, calendar }) → Strategy<TacticalFeatures>`. Hydrates a spec into a Strategy with hysteresis state and rebalance cadence. Also exports `isRebalanceDay`, `periodKey` |
| `evaluate-rule-tree.ts` | `evaluateRuleTree(rules, features, prevState) → { weights, state }`. Stateful: tracks per-comparison hysteresis |
| `evaluate-feature-specs.ts` | `evaluateFeatureSpecs(specs, runtime, t) → Map<id, value>`. Calls FeatureRuntime per feature, applies per-feature delay |
| `synthetics.ts` | `withSynthetics(dataFeed, synthetics) → DataFeed`. Wraps a feed to synthesize daily-reset leveraged bars from underlying assets |
| `index.ts` | Barrel |

## For AI Agents

### Working In This Directory
- `tactical/v0` is accepted with a one-time deprecation warning; `tactical/v1` is the current shape (byte-for-byte equivalent to v0)
- `fromSpec` returns `[]` orders when any required feature is undefined at time `t` (e.g. SMA200 before warmup) — by design; do not "fall through" to a default branch when features are missing
- Rebalance cadence (`Daily`/`Weekly`/`Monthly`/`Quarterly`/`Yearly`) is consulted by `isRebalanceDay(t, calendar, frequency)` — last session of the period
- Synthetic assets (`SyntheticAsset.leverage`) compound daily; the `withSynthetics` wrapper handles bar synthesis

### Testing Requirements
- Unit tests per file
- `integration.test.ts` exercises the full `fromSpec → runBacktest` pipeline including hysteresis, weekly cadence, leverage

### Common Patterns
- **Stateful hysteresis** — `evaluateRuleTree` carries per-comparison state across days. Same input + same prev-state → same output (deterministic)
- **Spec is data** — never put behavior in `TacticalSpec`. Functions, closures, derived state belong in the hydrator (`fromSpec`)
