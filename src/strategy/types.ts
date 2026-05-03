import type { Asset } from '../interfaces/types';
import type { Portfolio } from '../portfolio/types';
import type { Order } from '../orders/types';

/**
 * Constraint on the feature map type parameter used throughout the strategy API.
 * A `Features` object is a plain, readonly record that maps string keys to arbitrary
 * computed values. Keeping it generic (rather than forcing `Record<string, number>`)
 * lets callers attach structured objects, series snapshots, or price maps alongside
 * numeric scalars.
 */
export type Features = Readonly<Record<string, unknown>>;

/**
 * The contract that every allocation strategy must implement.
 *
 * The runtime loop calls these methods in order on every rebalance session:
 *
 * 1. `universe` — decide which assets are tradeable today.
 * 2. `features` — compute any indicators or derived values needed for the decision.
 * 3. `build` — emit a list of orders (and the next state value) given the feature snapshot.
 *
 * Invariants an implementation MUST uphold:
 * - `universe` must be synchronous and cheap; it is called before any I/O.
 * - `features` may be async and is responsible for all data fetching and
 *   indicator computation. The returned `F` value is passed verbatim to `build`.
 * - `build` must be synchronous. It receives the current portfolio, the
 *   full feature snapshot, and the carried-over state, and returns zero or more
 *   orders plus the next state value. Returning an empty array is a valid no-op
 *   (no rebalance).
 * - None of the three methods should have side effects on shared mutable state
 *   between calls; the portfolio is the single source of truth for position state.
 *
 * The `F` type parameter lets TypeScript verify that features produced by
 * `features()` exactly match what `build()` consumes, eliminating a whole class
 * of runtime key-mismatch bugs.
 *
 * The `S` type parameter (defaults to `void`) enables explicit state threading.
 * When `S = void`, the strategy is state-less: `initialState` is omitted, `build`
 * receives `undefined` for `state`, and may return either a legacy `ReadonlyArray<Order>`
 * or the new `{ orders, state: undefined }` form. When `S` is a concrete type,
 * `initialState()` is required and `build` must return `{ orders, state }` so the
 * runtime can carry the state forward without closures — enabling snapshot/restore
 * for preview-builds in live mode.
 *
 * @example State-less strategy (legacy shape — S = void):
 * ```ts
 * import type { Strategy, Features } from '@livefolio/sdk';
 *
 * type MyFeatures = { spy_sma20: number; spy_price: number } & Features;
 *
 * const myStrategy: Strategy<MyFeatures> = {
 *   universe: (_t, _portfolio) => [{ kind: 'equity', id: 'US:SPY', symbol: 'SPY' }],
 *
 *   features: async (_universe, _portfolio, _t) => ({
 *     spy_sma20: 432.5,
 *     spy_price: 440.0,
 *   }),
 *
 *   build: (features, _portfolio, _state, _t) => {
 *     if (features.spy_price > features.spy_sma20) {
 *       // buy signal — delegate actual order creation to reconcile()
 *     }
 *     return [];
 *   },
 * };
 * ```
 *
 * @example State-bearing strategy (S = { lastBar: number }):
 * ```ts
 * import type { Strategy, Features } from '@livefolio/sdk';
 *
 * type MyFeatures = { price: number } & Features;
 * type MyState = { lastBar: number };
 *
 * const myStrategy: Strategy<MyFeatures, MyState> = {
 *   universe: () => [{ kind: 'equity', id: 'US:SPY', symbol: 'SPY' }],
 *   features: async () => ({ price: 440 }),
 *   initialState: () => ({ lastBar: 0 }),
 *   build: (features, _portfolio, state, _t) => ({
 *     orders: [],
 *     state: { lastBar: features.price },
 *   }),
 * };
 * ```
 */
export interface Strategy<F extends Features = Features, S = void> {
  /**
   * Returns the set of assets that are eligible for trading on date `t`.
   *
   * The universe may change dynamically based on the current portfolio or
   * calendar date (e.g. exclusion lists, liquidity filters). Assets returned
   * here are the ones for which `features` will fetch data.
   *
   * @param t - The session date (midnight UTC on the trading day).
   * @param portfolio - The portfolio state carried into this session.
   * @returns A readonly array of `Asset` descriptors. May be empty if no assets
   *   are eligible; `build` will then receive no prices and should return `[]`.
   */
  universe(t: Date, portfolio: Portfolio): ReadonlyArray<Asset>;

  /**
   * Computes the feature snapshot used by `build` to make allocation decisions.
   *
   * This is the only async step in the strategy loop. Implementations typically
   * call `FeatureRuntime.compute` for each indicator, which handles caching and
   * data fetching transparently.
   *
   * @param universe - The assets returned by `universe()` for this session.
   * @param portfolio - The portfolio state at the start of this session.
   * @param t - The session date.
   * @returns A feature object of type `F`, or a promise that resolves to one.
   *   The object is passed unchanged to `build`.
   *
   * @example
   * ```ts
   * features: async (universe, _portfolio, t) => {
   *   const prices = await Promise.all(
   *     universe.map(async (asset) => {
   *       const s = await runtime.compute({ kind: 'price' }, asset);
   *       return [asset.id, seriesAt(s, t)] as const;
   *     }),
   *   );
   *   return { prices: new Map(prices) };
   * }
   * ```
   */
  features(universe: ReadonlyArray<Asset>, portfolio: Portfolio, t: Date): F | Promise<F>;

  /**
   * Returns the initial auxiliary state for this strategy. Optional — when
   * omitted, the runtime treats the strategy as state-less (`S = void`) and
   * passes `undefined` for `state` in every `build` call.
   *
   * Required for any strategy that holds hysteresis or other carry-over state
   * across rebalance steps. The returned value MUST be JSON-serializable so the
   * runtime can snapshot/restore it (preview-build during live mode) and so
   * `BacktestResult.finalState` round-trips through any persistence layer.
   */
  initialState?(): S;

  /**
   * Translates the feature snapshot into orders and the next state value.
   *
   * Must be synchronous. Returning an empty `orders` array is valid and means
   * "hold current positions unchanged". Typically delegates weight calculation
   * to `evaluateRuleTree` and order construction to `reconcile`.
   *
   * For state-less strategies (`S = void`), the legacy return shape
   * `ReadonlyArray<Order>` is still accepted — the runtime normalizes both forms.
   * New code should always return `{ orders, state }`.
   *
   * @param features - The value returned by `features()` for this session.
   * @param portfolio - The portfolio state at the start of this session.
   * @param state - The state carried over from the previous session. `undefined`
   *   when `S = void`.
   * @param t - The session date.
   * @returns Either a readonly array of `Order` objects (legacy state-less form)
   *   or `{ orders: ReadonlyArray<Order>; state: S }` (new state-bearing form).
   *   The executor receives the orders and converts them into `Fill` records that
   *   update the portfolio.
   */
  build(
    features: F,
    portfolio: Portfolio,
    state: S,
    t: Date,
  ): ReadonlyArray<Order> | { orders: ReadonlyArray<Order>; state: S };
}
