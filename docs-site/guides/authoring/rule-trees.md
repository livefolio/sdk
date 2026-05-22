# Rule trees

The `rules` field of a `TacticalSpec` is the strategy's decision logic. It is a binary tree of `RuleNode` values evaluated on every rebalance day. This page covers the two node types, the comparison operators, and hysteresis — the mechanism that prevents a strategy from whipsawing when prices oscillate near a threshold.

## Node types

A [`RuleNode`](/api/type-aliases/RuleNode) is a discriminated union:

```ts
type RuleNode = AllocateNode | IfNode;
```

### `AllocateNode` — terminal

```ts
type AllocateNode = {
  op: 'allocate';
  weights: Record<AssetId, number>;
};
```

An `AllocateNode` is a leaf. When the tree reaches one, evaluation stops and the weight map becomes the strategy's target for that session. Weights are fractions of NAV. Any unallocated fraction (total < 1.0) stays as uninvested cash.

### `IfNode` — branch

```ts
type IfNode = {
  op: 'if';
  cond: Comparison;
  then: RuleNode;
  else: RuleNode;
};
```

An `IfNode` evaluates `cond` and walks either `then` (when true) or `else` (when false). Both branches are themselves `RuleNode` values, so trees can be nested to any depth.

---

## Comparisons

```ts
type Comparison = {
  op: ComparisonOp;
  left: FeatureRef | number;
  right: FeatureRef | number;
  tolerance?: Tolerance;
  id?: string;
};

type ComparisonOp = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';

type FeatureRef = { ref: string };
```

Both `left` and `right` can be a feature reference (`{ ref: 'feature_id' }`) or a literal number. The comparison evaluates the resolved values using the given operator:

| Operator | Meaning |
|----------|---------|
| `'gt'` | `left > right` |
| `'lt'` | `left < right` |
| `'gte'` | `left >= right` |
| `'lte'` | `left <= right` |
| `'eq'` | `left === right` (strict, no epsilon — intended for integer-valued features compared against integer literals). With `tolerance`, becomes `left ∈ [right − tol, right + tol]` (symmetric range band). |

**Feature references** look up the named feature in the value map built from `TacticalSpec.features`. If a referenced feature has no value (e.g. insufficient history for an SMA), the entire rule tree evaluation is skipped for that session — the portfolio is left unchanged rather than generating an error.

---

## Hysteresis

Without special handling, a strategy can whipsaw: when a price oscillates just above and below a threshold it triggers a buy on Monday and a sell on Thursday, week after week. Hysteresis prevents this by introducing a dead band around the threshold — once a signal is active, it stays active until the market moves far enough in the opposite direction.

### How it works

```ts
type Tolerance = {
  value: number;
  mode: 'absolute' | 'relative';
};
```

Set `tolerance` on a `Comparison` to enable hysteresis. Two modes are available:

| Mode | Dead band |
|------|-----------|
| `'absolute'` | `[right − value, right + value]` |
| `'relative'` | `[right × (1 − value/100), right × (1 + value/100)]` |

The runtime maintains a per-comparison state bit (`0` = false, `1` = true). On each rebalance the previous state determines which edge of the band applies:

- **Signal currently active (`prev = 1`):** it stays active as long as the market has not crossed the lower edge of the band. It switches off only when `left` crosses below `right − tolerance`.
- **Signal currently inactive (`prev = 0`):** it stays inactive until `left` crosses above the upper edge of the band.

For `'gt'` with a 2 % relative band:
- **Flip on:** `left > right × 1.02`
- **Flip off:** `left < right × 0.98`

### The `id` field

When `tolerance` is set, `id` is **required**. The `id` string keys the state entry inside [`RuleTreeState`](/api/type-aliases/RuleTreeState) — a `ReadonlyMap<string, 0 | 1>` that `fromSpec` carries across rebalances. If you omit `id` on a comparison that has `tolerance`, the runtime throws at evaluation time.

::: tip Choosing an `id`
Pick a descriptive, stable string — e.g. `'spy_trend'`. Changing an `id` mid-backtest is equivalent to losing the prior state bit: the comparison initialises as if it had never been evaluated before.
:::

::: warning Tolerance only works with `gt` / `lt` / `eq`
Using `tolerance` with `'gte'` or `'lte'` is an error — those operators are exact-threshold comparisons where hysteresis does not make semantic sense.

For `'eq'`, `tolerance` defines a **symmetric range band**: the signal is `true` while `left ∈ [right − tol, right + tol]` and `false` outside. Entry and exit thresholds share the same edges, so the result is effectively stateless (no whipsaw protection — for that, use `'gt'` / `'lt'`). The state bit is still persisted via `id`, so `eq` slots into the same `RuleTreeState` pipeline as `gt`/`lt`.
:::

---

## Fallback patterns

Every `IfNode` requires both a `then` branch and an `else` branch, which means the tree always produces a concrete allocation. There are no implicit fallbacks or `null` states.

### Defensive `else`

The most common pattern is a two-branch tree where the `else` branch holds a safe-haven asset:

```ts
{
  op: 'if',
  cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma200' } },
  then: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
  else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },   // defensive fallback
}
```

### Multi-condition rules

Nest `IfNode` values to encode AND logic (both conditions must be true to reach an allocation):

```ts
{
  op: 'if',
  cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma200' } },
  then: {
    op: 'if',
    // Secondary filter: RSI not overbought
    cond: { op: 'lt', left: { ref: 'spy_rsi14' }, right: 75 },
    then: { op: 'allocate', weights: { 'us:SPY': 0.8, 'us:QQQ': 0.2 } },
    else: { op: 'allocate', weights: { 'us:SPY': 0.5, 'us:IEF': 0.5 } },
  },
  else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
}
```

### Partial allocation

Weights do not have to sum to 1.0. The remainder stays as cash, which can be useful when you want to size down risk deliberately:

```ts
{ op: 'allocate', weights: { 'us:SPY': 0.6, 'us:IEF': 0.3 } }
// 10 % stays in cash
```

---

## Sample — hysteresis in action

The sample below runs the same price series through two strategies — one without hysteresis and one with a 2 % relative band — and prints how many allocation flips each produces. The hysteresis version should show noticeably fewer flips.

<<< @/../scripts/docs/guides-authoring/rule-trees-hysteresis.ts

---

## What's next

- **[Synthetics](/guides/authoring/synthetics)** — model leveraged ETFs and fee drag.
- **[Rebalance schedules](/guides/authoring/rebalance-schedules)** — how often the rule tree runs and the turnover implications.
- **API:** [`RuleNode`](/api/type-aliases/RuleNode), [`Comparison`](/api/type-aliases/Comparison), [`evaluateRuleTree`](/api/functions/evaluateRuleTree)
