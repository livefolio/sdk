import type { AssetId } from '../interfaces/types';
import type { ReturnMode } from '../features/indicators/return';

/**
 * A reference to an asset within a {@link TacticalSpec}. Unlike the runtime
 * {@link Asset} type, `AssetRef` is the spec-form representation: it lives
 * inside serialized JSON specs and carries only the fields a spec author
 * needs to declare.
 *
 * `id` is the stable opaque identifier (see {@link AssetId}); `symbol` is the
 * human-readable ticker; `exchange` is optional. `kind` selects the asset
 * variant; absent `kind` defaults to `'equity'` for backward compatibility
 * with v0.4 specs authored before macro support landed.
 */
export type AssetRef = {
  /** Stable opaque asset identifier matching {@link AssetId}. */
  id: AssetId;
  /** Human-readable ticker symbol, e.g. `'AAPL'`. */
  symbol: string;
  /** Optional MIC or common exchange name, e.g. `'NYSE'`. Equity-only. */
  exchange?: string;
  /**
   * Asset class. Defaults to `'equity'` when omitted. Set to `'macro'` to
   * author FRED-style time-series assets that route to a non-equity
   * `DataFeed` (typically via `RoutingDataFeed`).
   */
  kind?: 'equity' | 'macro';
};

/**
 * A simulated leveraged or expense-adjusted asset that the runtime synthesizes
 * on-the-fly from its `underlying` data feed. The bar stream is computed by
 * {@link withSynthetics}, which wraps a real {@link DataFeed} and intercepts
 * requests for the synthetic's `id`.
 *
 * The synthesized daily close is:
 * ```
 * close_t = close_{t-1} × (1 + leverage × underlyingReturn_t) × (1 − expense/252)
 * ```
 *
 * @example
 * ```ts
 * import type { SyntheticAsset } from '@livefolio/sdk';
 *
 * const qqq3x: SyntheticAsset = {
 *   id:         'QQQ_3X',
 *   symbol:     'QQQ3X',
 *   underlying: { id: 'QQQ', symbol: 'QQQ' },
 *   leverage:   3,
 *   expense:    0.0095,  // 0.95% annual
 * };
 * ```
 */
export type SyntheticAsset = {
  /** Stable ID for this synthetic; must be unique in the spec universe. */
  id: AssetId;
  /** Display symbol for this synthetic. */
  symbol: string;
  /** Reference to the real asset whose returns are scaled. */
  underlying: AssetRef;
  /** Daily return multiplier (e.g. `3` for 3× leverage, `-1` for inverse). */
  leverage: number;
  /** Annual expense ratio as a decimal (e.g. `0.0095` for 0.95%). Defaults to 0. */
  expense?: number;
  /** When set, orders are routed to this proxy asset instead of the synthetic id. */
  tradeAs?: AssetRef;
};

/**
 * Cadence at which the strategy is allowed to rebalance.
 *
 * - `'Daily'`     — every trading day
 * - `'Weekly'`    — last trading day of each ISO week
 * - `'Monthly'`   — last trading day of each calendar month
 * - `'Quarterly'` — last trading day of each calendar quarter
 * - `'Yearly'`    — last trading day of each calendar year
 */
export type RebalanceFrequency = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';

/**
 * Controls when the strategy is permitted to issue rebalance orders.
 * If omitted from a {@link TacticalSpec}, the default is `{ frequency: 'Daily' }`.
 *
 * @see {@link isRebalanceDay} for the trading-calendar-aware gate implementation.
 */
export type RebalanceConfig = {
  /** How often the strategy may rebalance. */
  frequency: RebalanceFrequency;
};

/**
 * A single feature entry in a {@link TacticalSpec}. Each variant declares the
 * indicator kind, the asset to compute it on, and the time-series lookup
 * parameters. The `id` is the name used to reference the computed value in
 * {@link FeatureRef} inside the rule tree.
 *
 * Supported variants:
 * - `price`      — most-recent closing price
 * - `sma`        — simple moving average over `period` trading days
 * - `ema`        — exponential moving average over `period` trading days
 * - `rsi`        — relative strength index over `period` trading days
 * - `return`     — cumulative or log return over `period` trading days (see {@link ReturnMode})
 * - `volatility` — annualised rolling standard deviation over `period` trading days
 * - `drawdown`   — peak-to-trough drawdown over `period` trading days
 *
 * The optional `delay` shifts the lookup back by that many bars (0 = current
 * bar, 1 = previous bar, etc.). Useful for avoiding look-ahead bias when using
 * end-of-day prices.
 */
export type TacticalFeatureSpec =
  | { id: string; kind: 'price'; asset: AssetRef; delay?: number }
  | { id: string; kind: 'sma'; asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'ema'; asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'rsi'; asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'return'; asset: AssetRef; period: number; mode?: ReturnMode; delay?: number }
  | { id: string; kind: 'volatility'; asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'drawdown'; asset: AssetRef; period: number; delay?: number };

/**
 * Union of all indicator kind strings that can appear in a
 * {@link TacticalFeatureSpec}. Derived automatically from the spec union so it
 * stays in sync.
 */
export type TacticalFeatureKind = TacticalFeatureSpec['kind'];

/**
 * A reference to a computed feature value within a rule node. The `ref` string
 * must match an `id` declared in the `features` array of the enclosing
 * {@link TacticalSpec}. At evaluation time the runtime replaces the ref with
 * the resolved numeric value.
 *
 * @see {@link Comparison} where `FeatureRef` is accepted as an operand.
 */
export type FeatureRef = { ref: string };

/**
 * Binary comparison operator used in a {@link Comparison} node.
 *
 * - `'gt'`  — strictly greater than (`l > r`)
 * - `'lt'`  — strictly less than (`l < r`)
 * - `'gte'` — greater than or equal to (`l >= r`)
 * - `'lte'` — less than or equal to (`l <= r`)
 * - `'eq'`  — equality. Without {@link Tolerance}, this is strict `l === r`
 *   (no epsilon) — intended for comparing integer-valued features (e.g.
 *   calendar features like `dayOfWeek`) against integer literals. With
 *   {@link Tolerance}, this is "within the symmetric band around `r`" —
 *   `true` while `l ∈ [r − tol, r + tol]`, `false` outside. State is still
 *   persisted via {@link RuleTreeState} but, because entry and exit share
 *   the same band edges, the per-step result is effectively stateless.
 */
export type ComparisonOp = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';

/**
 * Tolerance band applied to a {@link Comparison} with `op: 'gt'`, `op: 'lt'`,
 * or `op: 'eq'`.
 *
 * For `gt` / `lt`, the band implements **hysteresis**: once the comparison
 * has flipped, it will not flip back until the left operand exits the band
 * around the right operand. Entry and exit thresholds differ.
 *
 * For `eq`, the band defines a **symmetric range** around `right`: the
 * comparison is `true` while `l ∈ [r − value, r + value]`. Entry and exit
 * share the same edges, so behavior is stateless in practice even though the
 * outcome is still recorded in {@link RuleTreeState}.
 *
 * `mode: 'absolute'` defines a ±`value` band around `right`.
 * `mode: 'relative'` defines a ±`value`% band (i.e. `value` is a percentage).
 *
 * A `Tolerance` requires the parent {@link Comparison} to carry a stable `id`
 * so the runtime can persist the last-known state across rebalance periods.
 */
export type Tolerance = {
  /** Half-width of the band. */
  value: number;
  /** `'absolute'` uses raw units; `'relative'` uses a percentage of `right`. */
  mode: 'absolute' | 'relative';
};

/**
 * A binary comparison between two operands. Each operand is either a literal
 * number or a {@link FeatureRef} resolved at evaluation time. The result is
 * `true` when `left op right` holds.
 *
 * When `tolerance` is provided the comparison implements hysteresis — the
 * result is sticky and only changes when the left operand exits the band. A
 * stable `id` is required in that case so {@link RuleTreeState} can track the
 * last outcome.
 *
 * @example
 * ```ts
 * import type { Comparison } from '@livefolio/sdk';
 *
 * // Feature "sma200" > feature "sma50"
 * const cond: Comparison = {
 *   op:    'gt',
 *   left:  { ref: 'sma200' },
 *   right: { ref: 'sma50' },
 * };
 * ```
 */
export type Comparison = {
  /** Which binary operator to apply. */
  op: ComparisonOp;
  /** Left-hand operand — a feature reference or a literal number. */
  left: FeatureRef | number;
  /** Right-hand operand — a feature reference or a literal number. */
  right: FeatureRef | number;
  /**
   * Optional tolerance band. Requires `op` to be `'gt'`, `'lt'`, or `'eq'`,
   * and requires `id` to be set. For `gt`/`lt` the band implements
   * hysteresis; for `eq` it defines a symmetric range around `right`.
   */
  tolerance?: Tolerance;
  /**
   * Stable identifier used to persist comparison state across steps when
   * `tolerance` is set. Must be unique within the rule tree.
   */
  id?: string;
};

/**
 * A leaf node in a {@link RuleNode} tree that terminates evaluation and
 * returns a target weight allocation. `weights` is a map from asset IDs to
 * fractional weights; weights should sum to 1 for a fully-invested portfolio,
 * but the runtime does not enforce this constraint.
 *
 * @example
 * ```ts
 * import type { AllocateNode } from '@livefolio/sdk';
 *
 * // 60% equities, 40% bonds
 * const node: AllocateNode = {
 *   op:      'allocate',
 *   weights: { SPY: 0.6, TLT: 0.4 },
 * };
 * ```
 */
export type AllocateNode = {
  op: 'allocate';
  /** Map from asset ID to target portfolio weight (0–1). */
  weights: Record<AssetId, number>;
};

/**
 * A branching node in a {@link RuleNode} tree. Evaluates `cond` and recurses
 * into `then` when the condition is true, or into `else` otherwise. Nesting
 * `IfNode` trees builds arbitrary decision logic over computed features.
 *
 * @example
 * ```ts
 * import type { IfNode } from '@livefolio/sdk';
 *
 * const node: IfNode = {
 *   op:   'if',
 *   cond: { op: 'gt', left: { ref: 'sma50' }, right: { ref: 'sma200' } },
 *   then: { op: 'allocate', weights: { SPY: 1 } },
 *   else: { op: 'allocate', weights: { SHY: 1 } },
 * };
 * ```
 */
export type IfNode = {
  op: 'if';
  /** Condition to evaluate. */
  cond: Comparison;
  /** Sub-tree evaluated when `cond` is true. */
  then: RuleNode;
  /** Sub-tree evaluated when `cond` is false. */
  else: RuleNode;
};

/**
 * A node in the tactical rule tree. Either a branching {@link IfNode} or a
 * terminal {@link AllocateNode}.
 *
 * - `op: 'if'`       — see {@link IfNode}
 * - `op: 'allocate'` — see {@link AllocateNode}
 */
export type RuleNode = AllocateNode | IfNode;

/**
 * A fully self-contained declaration of a tactical allocation strategy. Plain
 * data — no methods, no closures. Pass to {@link fromSpec} to obtain a
 * runnable {@link Strategy}.
 *
 * The dialect version distinguishes `'tactical/v0'` (deprecated, byte-for-byte
 * equivalent to v1, emits a one-time console warning) from `'tactical/v1'` (current).
 *
 * @example
 * ```ts
 * import type { TacticalSpec } from '@livefolio/sdk';
 *
 * const spec: TacticalSpec = {
 *   kind:     'tactical/v1',
 *   universe: [
 *     { id: 'SPY', symbol: 'SPY' },
 *     { id: 'SHY', symbol: 'SHY' },
 *   ],
 *   rebalance: { frequency: 'Monthly' },
 *   features: [
 *     { id: 'spy_sma200', kind: 'sma', asset: { id: 'SPY', symbol: 'SPY' }, period: 200 },
 *     { id: 'spy_price',  kind: 'price', asset: { id: 'SPY', symbol: 'SPY' } },
 *   ],
 *   rules: {
 *     op:   'if',
 *     cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma200' } },
 *     then: { op: 'allocate', weights: { SPY: 1 } },
 *     else: { op: 'allocate', weights: { SHY: 1 } },
 *   },
 * };
 * ```
 */
export type TacticalSpec = {
  /**
   * Dialect version. Use `'tactical/v1'`. `'tactical/v0'` is accepted but
   * deprecated and will emit a one-time warning.
   */
  kind: 'tactical/v0' | 'tactical/v1';
  /** Ordered list of assets eligible for allocation. */
  universe: AssetRef[];
  /** Optional synthetic assets whose bar data is derived from an underlying. */
  synthetics?: SyntheticAsset[];
  /** Rebalance cadence. Defaults to `{ frequency: 'Daily' }` when omitted. */
  rebalance?: RebalanceConfig;
  /** Named feature computations referenced by the rule tree. */
  features: TacticalFeatureSpec[];
  /** Root of the rule tree that maps resolved feature values to target weights. */
  rules: RuleNode;
};

/**
 * Persistent state carried across rebalance steps for all named {@link Comparison}
 * nodes that use hysteresis (`tolerance` set). Maps `comparison.id` to the last
 * evaluated outcome: `1` = condition was true, `0` = condition was false.
 *
 * Managed internally by {@link fromSpec}; exposed as a type for testing and
 * for callers that drive {@link evaluateRuleTree} directly.
 */
export type RuleTreeState = ReadonlyMap<string, 0 | 1>;
