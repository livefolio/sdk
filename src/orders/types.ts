import type { Asset } from '../interfaces/types';

import type { PositionId } from '../portfolio/types';
export type { PositionId };

/**
 * Opens a new position in `asset`. The executor creates a fresh {@link Position}
 * entry and debits cash by `quantity * fillPrice + fees`.
 *
 * @example
 * ```ts
 * import type { OpenOrder } from '@livefolio/sdk';
 *
 * const order: OpenOrder = {
 *   id:       'ord_001',
 *   kind:     'open',
 *   asset:    { kind: 'equity', id: 'AAPL', symbol: 'AAPL' },
 *   side:     'long',
 *   quantity: 100,
 *   tag:      'momentum-entry',
 * };
 * ```
 */
export type OpenOrder = {
  /** Caller-supplied identifier carried back on the resulting {@link Fill} via `orderRef`. */
  id: string;
  kind: 'open';
  /** The instrument to buy (long) or sell short. */
  asset: Asset;
  /** `'long'` to buy; `'short'` to sell short. */
  side: 'long' | 'short';
  /** Number of shares (or units) to transact. Must be positive. */
  quantity: number;
  /** Optional label propagated to the resulting {@link Position} for analysis. */
  tag?: string;
};

/**
 * Closes an existing position identified by `positionId`. If `quantity` is
 * supplied, only that many shares are closed (partial close); omitting
 * `quantity` closes the entire position.
 *
 * @example
 * ```ts
 * import type { CloseOrder } from '@livefolio/sdk';
 *
 * const order: CloseOrder = {
 *   id:         'ord_002',
 *   kind:       'close',
 *   positionId: 'pos_1',
 * };
 * ```
 */
export type CloseOrder = {
  /** Caller-supplied identifier carried back on the resulting {@link Fill} via `orderRef`. */
  id: string;
  kind: 'close';
  /** ID of the {@link Position} to close. */
  positionId: PositionId;
  /**
   * Shares to close. Omit to close the full position. Must not exceed
   * the position's current quantity.
   */
  quantity?: number;
};

/**
 * Adjusts fields of an existing position without fully closing it. Currently
 * supports changing `quantity` (e.g. after a corporate action). Cash is not
 * affected other than deducting fees.
 *
 * @example
 * ```ts
 * import type { AdjustOrder } from '@livefolio/sdk';
 *
 * const order: AdjustOrder = {
 *   id:         'ord_003',
 *   kind:       'adjust',
 *   positionId: 'pos_1',
 *   changes:    { quantity: 150 },
 * };
 * ```
 */
export type AdjustOrder = {
  /** Caller-supplied identifier carried back on the resulting {@link Fill} via `orderRef`. */
  id: string;
  kind: 'adjust';
  /** ID of the {@link Position} to modify. */
  positionId: PositionId;
  /**
   * Fields to update. Currently only `quantity` is supported. Omitting a
   * field leaves it unchanged.
   */
  changes: { quantity?: number };
};

/**
 * Adjusts a long position in `asset` by `delta` shares. Positive `delta`
 * increases the position (buy); negative `delta` decreases it (sell). If no
 * position exists and `delta > 0`, a new position is opened.
 *
 * Used by the rebalance engine when transitioning a portfolio to target
 * weights — strategy code typically does not construct these directly.
 *
 * @example
 * ```ts
 * import type { RebalanceOrder } from '@livefolio/sdk';
 *
 * const order: RebalanceOrder = {
 *   id:    'ord_004',
 *   kind:  'rebalance',
 *   asset: { kind: 'equity', id: 'MSFT', symbol: 'MSFT' },
 *   delta: -50,  // reduce long by 50 shares
 * };
 * ```
 */
export type RebalanceOrder = {
  /** Caller-supplied identifier carried back on the resulting {@link Fill} via `orderRef`. */
  id: string;
  kind: 'rebalance';
  /** The instrument whose long position is being adjusted. */
  asset: Asset;
  /**
   * Share delta. Positive → buy more; negative → sell (reduce or close).
   * Zero-delta orders MUST be omitted by callers.
   */
  delta: number;
};

/**
 * Discriminated union of all order types. Narrow on `order.kind` to access
 * kind-specific fields.
 *
 * Variants:
 * - `'open'`      — {@link OpenOrder}: opens a new long or short position.
 * - `'close'`     — {@link CloseOrder}: closes an existing position fully or partially.
 * - `'adjust'`    — {@link AdjustOrder}: mutates fields of an existing position.
 * - `'rebalance'` — {@link RebalanceOrder}: delta-adjusts a long position; used by the
 *   rebalance engine.
 *
 * @example
 * ```ts
 * import type { Order } from '@livefolio/sdk';
 *
 * function describe(order: Order): string {
 *   switch (order.kind) {
 *     case 'open':      return `open ${order.side} ${order.quantity} ${order.asset.symbol}`;
 *     case 'close':     return `close position ${order.positionId}`;
 *     case 'adjust':    return `adjust position ${order.positionId}`;
 *     case 'rebalance': return `rebalance ${order.asset.symbol} by ${order.delta}`;
 *   }
 * }
 * ```
 */
export type Order = OpenOrder | CloseOrder | AdjustOrder | RebalanceOrder;

/**
 * Execution confirmation returned by {@link Executor.submit}. Each fill
 * corresponds to one order and records the exact price, quantity, and fees
 * that were transacted.
 *
 * @example
 * ```ts
 * import type { Fill } from '@livefolio/sdk';
 *
 * const fill: Fill = {
 *   orderRef: 'ord_001',
 *   t:        new Date('2024-06-04T13:30:00Z'),
 *   quantity: 100,
 *   price:    152.75,
 *   fees:     0.50,
 * };
 * ```
 */
export type Fill = {
  /** References the `id` of the originating {@link Order}. */
  orderRef: string;
  /** Timestamp at which the fill was executed (>= the order submission time). */
  t: Date;
  /** Shares (or units) actually transacted. May be less than the ordered quantity for partial fills. */
  quantity: number;
  /** Per-share execution price after slippage. */
  price: number;
  /** Total transaction fees in the portfolio's base currency. */
  fees: number;
};
