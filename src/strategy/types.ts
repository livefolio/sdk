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
 * The three-method contract that every allocation strategy must implement.
 *
 * The runtime loop calls these three methods in order on every rebalance session:
 *
 * 1. `universe` — decide which assets are tradeable today.
 * 2. `features` — compute any indicators or derived values needed for the decision.
 * 3. `build` — emit a list of orders given the feature snapshot.
 *
 * Invariants an implementation MUST uphold:
 * - `universe` must be synchronous and cheap; it is called before any I/O.
 * - `features` may be async and is responsible for all data fetching and
 *   indicator computation. The returned `F` value is passed verbatim to `build`.
 * - `build` must be synchronous. It receives the current portfolio and the
 *   full feature snapshot, and returns zero or more orders. Returning an empty
 *   array is a valid no-op (no rebalance).
 * - None of the three methods should have side effects on shared mutable state
 *   between calls; the portfolio is the single source of truth for position state.
 *
 * The `F` type parameter lets TypeScript verify that features produced by
 * `features()` exactly match what `build()` consumes, eliminating a whole class
 * of runtime key-mismatch bugs.
 *
 * @example
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
 *   build: (features, _portfolio, _t) => {
 *     if (features.spy_price > features.spy_sma20) {
 *       // buy signal — delegate actual order creation to reconcile()
 *     }
 *     return [];
 *   },
 * };
 * ```
 */
export interface Strategy<F extends Features = Features> {
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
   * Translates the feature snapshot into a list of orders for this session.
   *
   * Must be synchronous. Returning an empty array is valid and means "hold current
   * positions unchanged". Typically delegates weight calculation to `evaluateRuleTree`
   * and order construction to `reconcile`.
   *
   * @param features - The value returned by `features()` for this session.
   * @param portfolio - The portfolio state at the start of this session.
   * @param t - The session date.
   * @returns A readonly array of `Order` objects. The executor receives these orders
   *   and converts them into `Fill` records that update the portfolio.
   */
  build(features: F, portfolio: Portfolio, t: Date): ReadonlyArray<Order>;
}
