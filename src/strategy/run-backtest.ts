import type { Strategy, Features } from './types';
import type { Portfolio } from '../portfolio/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { Executor } from '../interfaces/executor';
import type { Calendar } from '../interfaces/calendar';
import type { FeatureCache } from '../interfaces/feature-cache';
import type { DateRange, Frequency } from '../interfaces/types';
import type { Order, Fill } from '../orders/types';
import { applyFills } from '../portfolio/apply';

/**
 * Narrows the dual return type of `Strategy.build` to the stateful object form.
 *
 * `Array.isArray` does not narrow `ReadonlyArray<T>` out of a union in TypeScript 5.x
 * when the other arm is an object type, so we use an explicit type predicate instead.
 * The helper is defined at module scope so `runLive` (Task 8) can reuse it.
 */
function isStateResult<S>(
  r: ReadonlyArray<Order> | { orders: ReadonlyArray<Order>; state: S },
): r is { orders: ReadonlyArray<Order>; state: S } {
  return !Array.isArray(r);
}

/**
 * All inputs required to run a historical backtest.
 *
 * Callers must provide a concrete `Strategy`, a `DateRange`, and the four
 * pluggable runtime layers (`dataFeed`, `executor`, `calendar`, `featureCache`).
 * The reference implementations (`MemoryFeatureCache`, `BacktestExecutor`,
 * `NYSEExchangeCalendar`) satisfy all four without network dependencies.
 */
export type RunBacktestOptions<F extends Features = Features, S = unknown> = {
  /** The strategy under test. Must implement `universe`, `features`, and `build`. */
  strategy: Strategy<F, S>;
  /**
   * Inclusive date range over which to iterate. The calendar resolves this
   * range into the actual sequence of trading sessions.
   */
  range: DateRange;
  /**
   * Starting portfolio state. Cash and positions are carried forward through
   * the simulation as orders are filled. This value is never mutated.
   */
  initialPortfolio: Portfolio;
  /**
   * Source of OHLCV bar data and optionally fundamentals / corporate events.
   * `FeatureRuntime` uses this to hydrate price series before computing indicators.
   */
  dataFeed: DataFeed;
  /**
   * Order router responsible for converting `Order` objects into `Fill` records.
   * Use `BacktestExecutor` for historical simulations or swap in a live
   * broker implementation for paper/live trading.
   */
  executor: Executor;
  /**
   * Trading-day calendar. Used to enumerate `sessions` within `range` and to
   * determine rebalance day boundaries via `next`.
   */
  calendar: Calendar;
  /**
   * Optional persistent indicator cache. When omitted, each `runBacktest` call
   * recomputes all indicators from scratch. Provide `MemoryFeatureCache` (or a
   * cross-process cache) to memoize results across multiple runs.
   */
  featureCache?: FeatureCache;
  /**
   * Bar frequency forwarded to `DataFeed.bars`. Defaults to `'1d'` when omitted.
   * Must match the granularity expected by the strategy's indicator specs.
   */
  freq?: Frequency;
};

/**
 * A point-in-time snapshot of the simulation at the end of a single trading session.
 *
 * Each entry in `BacktestResult.snapshots` corresponds to one call of the strategy
 * loop: `universe → features → build → executor.submit → applyFills`.
 */
export type BacktestSnapshot = {
  /** The session date for this snapshot (midnight UTC on the trading day). */
  t: Date;
  /** Portfolio state *after* fills have been applied for this session. */
  portfolio: Portfolio;
  /** Orders emitted by `strategy.build` during this session. */
  orders: ReadonlyArray<Order>;
  /** Fills returned by the executor for the orders above. */
  fills: ReadonlyArray<Fill>;
};

/**
 * The return value of `runBacktest`, containing the full simulation history
 * and the terminal portfolio state.
 */
export type BacktestResult<S = unknown> = {
  /**
   * Ordered list of snapshots, one per trading session in `range`. Empty when
   * the calendar has no sessions in the requested range.
   */
  snapshots: ReadonlyArray<BacktestSnapshot>;
  /**
   * Portfolio after the last session's fills have been applied. Equivalent to
   * `snapshots[snapshots.length - 1].portfolio` when there is at least one session,
   * or `initialPortfolio` when the range is empty.
   */
  finalPortfolio: Portfolio;
  /**
   * Final value of the strategy's auxiliary state after the last `build()` call.
   * `undefined` when the strategy is state-less (no `initialState()` defined).
   * Used by `runLive` to seed the live runtime so the first live tick continues
   * from the exact state the historical run ended on.
   */
  finalState: S | undefined;
};

/**
 * Drives a `Strategy` over a historical date range and returns a full audit trail
 * of orders, fills, and portfolio states.
 *
 * The simulation loop:
 * 1. Enumerate trading sessions via `opts.calendar.sessions(opts.range)`.
 * 2. Call `strategy.initialState?.()` once to seed the carry-over state.
 * 3. For each session `t`, call `strategy.universe(t, portfolio)`.
 * 4. Await `strategy.features(universe, portfolio, t)`.
 * 5. Call `strategy.build(features, portfolio, state, t)` to obtain orders and
 *    the next state value. Both legacy `Order[]` returns and new `{ orders, state }`
 *    returns are normalised — the legacy form leaves state unchanged.
 * 6. Await `opts.executor.submit(orders, t, portfolio)` to obtain fills.
 * 7. Apply fills to the portfolio with `applyFills`.
 * 8. Append a `BacktestSnapshot` and advance to the next session.
 *
 * The portfolio is never mutated in place; each session receives the immutable
 * result of the previous session's `applyFills`.
 *
 * @param opts - Backtest configuration. See {@link RunBacktestOptions}.
 * @returns A promise that resolves to a {@link BacktestResult} containing one
 *   snapshot per trading session, the final portfolio state, and the final
 *   strategy state (`finalState`). Returns
 *   `{ snapshots: [], finalPortfolio: opts.initialPortfolio, finalState: undefined }`
 *   when the calendar has no sessions in the requested range.
 *
 * @example
 * ```ts
 * import {
 *   runBacktest,
 *   fromSpec,
 *   MemoryFeatureCache,
 *   BacktestExecutor,
 *   NYSEExchangeCalendar,
 *   FeatureRuntime,
 * } from '@livefolio/sdk';
 *
 * const calendar = new NYSEExchangeCalendar();
 * const range = { from: new Date('2023-01-01'), to: new Date('2023-12-31') };
 * const featureCache = new MemoryFeatureCache();
 * const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });
 *
 * const strategy = fromSpec(myTacticalSpec, { runtime, calendar });
 *
 * const result = await runBacktest({
 *   strategy,
 *   range,
 *   initialPortfolio: { cash: 100_000, positions: [] },
 *   dataFeed,
 *   executor: new BacktestExecutor({ dataFeed }),
 *   calendar,
 *   featureCache,
 *   freq: '1d',
 * });
 *
 * console.log(result.finalPortfolio.cash);
 * console.log(result.snapshots.length); // one entry per NYSE trading day in 2023
 * ```
 */
export async function runBacktest<F extends Features = Features, S = unknown>(
  opts: RunBacktestOptions<F, S>,
): Promise<BacktestResult<S>> {
  const initialStateValue: S | undefined = opts.strategy.initialState?.();
  const sessions = opts.calendar.sessions(opts.range);
  if (sessions.length === 0) {
    return {
      snapshots: [],
      finalPortfolio: opts.initialPortfolio,
      finalState: initialStateValue,
    };
  }

  let portfolio = opts.initialPortfolio;
  let state: S | undefined = initialStateValue;
  const snapshots: BacktestSnapshot[] = [];

  for (const t of sessions) {
    const universe = opts.strategy.universe(t, portfolio);
    const features = await opts.strategy.features(universe, portfolio, t);
    const buildResult = opts.strategy.build(features, portfolio, state as S, t);

    let orders: ReadonlyArray<Order>;
    if (isStateResult(buildResult)) {
      orders = buildResult.orders;
      state = buildResult.state;
    } else {
      // Legacy state-less return shape — state unchanged.
      orders = buildResult;
    }

    const fills = await opts.executor.submit(orders, t, portfolio);
    portfolio = applyFills(portfolio, fills, orders);
    snapshots.push({ t, portfolio, orders, fills });
  }

  return { snapshots, finalPortfolio: portfolio, finalState: state };
}
