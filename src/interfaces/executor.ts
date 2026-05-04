import type { Order, Fill } from '../orders/types';
import type { Portfolio } from '../portfolio/types';

/**
 * Order-routing layer. Translates a set of {@link Order} objects into
 * confirmed {@link Fill} records.
 *
 * Implementations MUST guarantee:
 * - `submit` returns one {@link Fill} per order that was (at least partially)
 *   executed. Orders that produce zero fills (e.g. quantity of 0) MUST be
 *   omitted from the result rather than emitting a zero-quantity fill.
 * - `submit` MUST be **idempotent per unique order id**: submitting the same
 *   `Order` array twice with the same ids MUST NOT double-fill positions.
 * - Fill timestamps (`fill.t`) MUST be `>= t`.
 * - The function is `async`; implementations that need to call a broker API
 *   or await next-bar price data should resolve only after execution is
 *   confirmed or simulated.
 *
 * Reference implementation: {@link BacktestExecutor} — fills at next-open with
 * configurable slippage and per-share fees.
 *
 * @example
 * ```ts
 * import type { Executor, Order, Fill, Portfolio } from '@livefolio/sdk';
 * import { vi } from 'vitest';
 *
 * const executor: Executor = {
 *   submit: vi.fn().mockResolvedValue([] as ReadonlyArray<Fill>),
 * };
 * ```
 */
export interface Executor {
  /**
   * Submits a batch of orders for execution and returns the resulting fills.
   *
   * @param orders    - The orders to execute. Each order has a unique `id`;
   *   implementations use `id` to correlate fills via `fill.orderRef`.
   * @param t         - The logical "now" timestamp at which orders are being
   *   submitted (e.g. end-of-day for a daily-rebalance strategy).
   * @param portfolio - The current portfolio state at time `t`. Implementations
   *   may use this to resolve position details for close/adjust orders.
   * @returns A readonly array of {@link Fill} records. One fill per executed
   *   order; omit orders that result in zero quantity.
   */
  submit(orders: ReadonlyArray<Order>, t: Date, portfolio: Portfolio): Promise<ReadonlyArray<Fill>>;
}
