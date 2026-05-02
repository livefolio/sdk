# Anatomy of a TacticalSpec

A `TacticalSpec` is a plain TypeScript object — no classes, no closures — that describes everything needed to run a tactical allocation strategy. Because it is pure data, the same spec can drive a backtest today and live execution tomorrow without any code changes. This page walks through every field in the order it appears in the type definition.

## The full type surface

```ts
type TacticalSpec = {
  kind: 'tactical/v0' | 'tactical/v1';
  universe: AssetRef[];
  synthetics?: SyntheticAsset[];
  rebalance?: RebalanceConfig;
  features: TacticalFeatureSpec[];
  rules: RuleNode;
};
```

All fields are explained below. See the [API reference](/api/type-aliases/TacticalSpec) for the generated type docs.

---

## `kind`

The dialect identifier tells the runtime which version of the spec format you are using.

| Value | Status |
|-------|--------|
| `'tactical/v1'` | Current. Use this for all new strategies. |
| `'tactical/v0'` | Accepted but deprecated. Byte-for-byte equivalent to `v1`; emits a console warning once per process. Migrate by changing the string. |

There is no functional difference between `v0` and `v1` at runtime. The distinction exists so the SDK can warn users who are copying old examples.

---

## `universe`

An array of [`AssetRef`](/api/type-aliases/AssetRef) objects — the complete set of assets the strategy can trade.

```ts
type AssetRef = {
  id: AssetId;       // stable, exchange-scoped identifier  e.g. 'us:SPY'
  symbol: string;    // human-readable ticker               e.g. 'SPY'
  exchange?: string; // optional exchange tag               e.g. 'XNAS'
};
```

**Why it exists:** The runtime fetches prices and computes features only for universe members. Keeping the set explicit lets the SDK pre-warm the feature cache and validate that every weight in `rules` maps to a real asset.

**Rules:**
- Every `AssetId` referenced in an `AllocateNode` weight map must appear in `universe`.
- `id` is the canonical key; `symbol` is only used for display and `DataFeed` look-ups.
- Synthetic assets can appear in `universe` — see the [`synthetics`](#synthetics) field and [Synthetics guide](/guides/authoring/synthetics).

---

## `synthetics` (optional)

An array of [`SyntheticAsset`](/api/type-aliases/SyntheticAsset) definitions. Omit the field entirely if you only trade real tickers.

```ts
type SyntheticAsset = {
  id: AssetId;
  symbol: string;
  underlying: AssetRef;   // the real asset to derive from
  leverage: number;       // e.g. 2 for 2x, -1 for inverse
  expense?: number;       // annual expense ratio in percent, e.g. 0.91
  tradeAs?: AssetRef;     // if set, orders route to this ticker instead
};
```

The SDK synthesises daily bars by applying daily-reset leverage compounding plus a fractional expense drag:

```
close_t = close_{t-1} × (1 + leverage × r_t) × (1 − expense / 252)
```

Use `synthetics` to model leveraged ETFs (SSO = 2× SPY) or fee-bearing wrappers in a backtest without needing the ETF's real price history. See the [Synthetics guide](/guides/authoring/synthetics) for a worked example.

---

## `rebalance` (optional)

A [`RebalanceConfig`](/api/type-aliases/RebalanceConfig) that controls how often the rule tree is evaluated.

```ts
type RebalanceConfig = {
  frequency: RebalanceFrequency;
};

type RebalanceFrequency = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
```

**Default:** omitting `rebalance` is equivalent to `{ frequency: 'Daily' }`.

The runtime calls [`isRebalanceDay`](/api/functions/isRebalanceDay) on each trading session. A session is a rebalance day when it is the last trading day of its period (e.g. the last trading day of the week for `'Weekly'`). Only on rebalance days does `fromSpec` invoke the rule tree and generate orders.

For a detailed trade-off discussion, see [Rebalance schedules](/guides/authoring/rebalance-schedules).

---

## `features`

An array of named indicator definitions. Each entry is a [`TacticalFeatureSpec`](/api/type-aliases/TacticalFeatureSpec) — a discriminated union keyed by `kind`.

```ts
type TacticalFeatureSpec =
  | { id: string; kind: 'price';      asset: AssetRef; delay?: number }
  | { id: string; kind: 'sma';        asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'ema';        asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'rsi';        asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'return';     asset: AssetRef; period: number; mode?: ReturnMode; delay?: number }
  | { id: string; kind: 'volatility'; asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'drawdown';   asset: AssetRef; period: number; delay?: number };
```

| Kind | Description |
|------|-------------|
| `price` | Raw close price of `asset` on the evaluation date |
| `sma` | Simple moving average over `period` trading days |
| `ema` | Exponential moving average over `period` trading days |
| `rsi` | Wilder-smoothed Relative Strength Index over `period` days |
| `return` | Rolling total return over `period` days (`mode`: `'arithmetic'` or `'log'`) |
| `volatility` | Rolling annualised standard deviation of daily returns over `period` days |
| `drawdown` | Rolling maximum drawdown from peak over `period` days |

The `id` string becomes the key in the feature value map. The `rules` tree references features via `{ ref: 'id' }`. Feature results are memoised by the `FeatureCache` so they are computed at most once per `(spec, asset, date)` triple.

---

## `rules`

A [`RuleNode`](/api/type-aliases/RuleNode) — the root of a binary decision tree. At runtime, the tree is walked top-down; the first [`AllocateNode`](/api/type-aliases/AllocateNode) reached produces the target weights for that session.

```ts
// Terminal node — produces a weight map
type AllocateNode = {
  op: 'allocate';
  weights: Record<AssetId, number>;
};

// Branch node — evaluates a Comparison, then walks `then` or `else`
type IfNode = {
  op: 'if';
  cond: Comparison;
  then: RuleNode;
  else: RuleNode;
};
```

The `weights` map must reference only asset ids present in `universe`. Weights should sum to ≤ 1.0; any remainder stays as uninvested cash.

For full rule-tree semantics, operator details, and hysteresis bands, see [Rule trees](/guides/authoring/rule-trees).

---

## Annotated example

The sample below declares a complete spec with every field annotated. It then runs a short backtest with a synthetic DataFeed so it is fully self-contained.

<<< @/../scripts/docs/guides-authoring/anatomy.ts

---

## What's next

- **[Rule trees](/guides/authoring/rule-trees)** — operator semantics, hysteresis bands, multi-condition patterns.
- **[Synthetics](/guides/authoring/synthetics)** — modelling leveraged ETFs and fee drag.
- **[Rebalance schedules](/guides/authoring/rebalance-schedules)** — trade-off analysis and turnover implications.
