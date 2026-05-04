import type { Executor } from '../interfaces/executor';
import type { Calendar } from '../interfaces/calendar';
import type { Asset } from '../interfaces/types';
import type { Order, Fill } from '../orders/types';
import type { Portfolio } from '../portfolio/types';

/**
 * Callback that resolves the next-open price for `asset` as seen from date `t`.
 * {@link BacktestExecutor} calls this once per order to determine the fill price.
 *
 * The function should return the opening price of the first trading session
 * strictly after `t`, along with that session's timestamp. In a typical
 * backtest setup this reads from the same data feed used to compute features.
 *
 * @param asset - The instrument being filled.
 * @param t     - The date on which the rebalance order was submitted (the
 *                "signal date"). The fill should occur on the next open after
 *                this date to avoid look-ahead.
 * @returns An object with the fill timestamp `t` and the opening `price`.
 */
export type NextOpenFn = (asset: Asset, t: Date) => Promise<{ t: Date; price: number }>;

/**
 * Constructor options for {@link BacktestExecutor}.
 */
export type BacktestExecutorOptions = {
  /** Exchange calendar used to route fills to the next open session. */
  calendar: Calendar;
  /**
   * Callback that resolves the next-open price for a given asset and date.
   * See {@link NextOpenFn} for the exact contract.
   */
  nextOpen: NextOpenFn;
  /**
   * One-way slippage in basis points applied to every fill. The fill price is
   * adjusted by `price × (1 + sign × slippageBps / 10 000)` where `sign` is
   * `+1` for buys and `−1` for sells. Defaults to `0`.
   */
  slippageBps?: number;
  /**
   * Flat per-share commission in the portfolio's base currency. Multiplied by
   * the fill quantity and recorded in `Fill.fees`. Defaults to `0`.
   */
  perShareFee?: number;
};

function resolveAsset(order: Order, portfolio: Portfolio): { asset: Asset; sign: 1 | -1; qty: number } {
  switch (order.kind) {
    case 'open':
      return { asset: order.asset, sign: order.side === 'long' ? 1 : -1, qty: order.quantity };
    case 'rebalance':
      return { asset: order.asset, sign: order.delta >= 0 ? 1 : -1, qty: Math.abs(order.delta) };
    case 'close': {
      const p = portfolio.positions.find((x) => x.id === order.positionId);
      if (!p) throw new Error(`BacktestExecutor: close target position ${order.positionId} not found`);
      return { asset: p.asset, sign: p.side === 'long' ? -1 : 1, qty: order.quantity ?? p.quantity };
    }
    case 'adjust': {
      const p = portfolio.positions.find((x) => x.id === order.positionId);
      if (!p) throw new Error(`BacktestExecutor: adjust target position ${order.positionId} not found`);
      const target = order.changes.quantity ?? p.quantity;
      const delta = target - p.quantity;
      return { asset: p.asset, sign: delta >= 0 ? 1 : -1, qty: Math.abs(delta) };
    }
  }
}

/**
 * Reference {@link Executor} implementation for backtesting. Fills each order
 * at the next-open price returned by the {@link NextOpenFn} callback, with
 * optional slippage and per-share commissions applied.
 *
 * **When to use**: suitable for historical simulations and unit tests where
 * real broker connectivity is not needed. For live or paper trading, substitute
 * a broker-backed `Executor` that satisfies the same interface.
 *
 * **Fill mechanics**: for each order in `orders`, the executor calls
 * `opts.nextOpen(asset, t)` to obtain the fill price and timestamp. The
 * raw price is then adjusted for slippage:
 * ```
 * adjustedPrice = nextOpen.price × (1 + sign × slippageBps / 10 000)
 * ```
 * where `sign` is `+1` for net-buy direction and `−1` for net-sell direction.
 * A flat per-share fee is added to `Fill.fees`. Orders with zero quantity are
 * silently skipped.
 *
 * @example
 * ```ts
 * import { BacktestExecutor } from '@livefolio/sdk';
 * import { getCalendar } from '@livefolio/sdk';
 *
 * const executor = new BacktestExecutor({
 *   calendar:    getCalendar('NYSE'),
 *   nextOpen:    async (asset, t) => {
 *     // Return the first open bar strictly after t from your data feed.
 *     const bar = await feed.nextBar(asset, t);
 *     return { t: bar.t, price: bar.open };
 *   },
 *   slippageBps: 5,    // 0.05% one-way
 *   perShareFee: 0.005,
 * });
 * ```
 */
export class BacktestExecutor implements Executor {
  constructor(private readonly opts: BacktestExecutorOptions) {}

  async submit(orders: ReadonlyArray<Order>, t: Date, portfolio: Portfolio): Promise<ReadonlyArray<Fill>> {
    const fills: Fill[] = [];
    const slip = (this.opts.slippageBps ?? 0) / 10_000;
    const feePer = this.opts.perShareFee ?? 0;

    for (const order of orders) {
      const { asset, sign, qty } = resolveAsset(order, portfolio);
      if (qty === 0) continue;
      const open = await this.opts.nextOpen(asset, t);
      const adjustedPrice = open.price * (1 + sign * slip);
      fills.push({
        orderRef: order.id,
        t: open.t,
        quantity: qty,
        price: adjustedPrice,
        fees: feePer * qty,
      });
    }
    return fills;
  }
}
