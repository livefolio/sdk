import type { Executor } from '../interfaces/executor';
import type { Calendar } from '../interfaces/calendar';
import type { Asset } from '../interfaces/types';
import type { Order, Fill } from '../orders/types';
import type { Portfolio } from '../portfolio/types';
import { selectLIFO, selectHIFO, selectMinTax, type LotSlice } from '../tax/lot-selection';

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
  /**
   * Tax-lot selection method applied to long sells (a `rebalance` reduce or a
   * `close` of a long position). When set to a non-default method
   * (`'LIFO'` / `'HIFO'` / `'min-tax'`), such a sell is split into one
   * {@link Fill} per selected lot — each carrying `Fill.lotId` — so
   * {@link applyFills} consumes those exact lots.
   *
   * Defaults to `'FIFO'` (equivalently, leaving this unset): the executor emits
   * a single fill per order with no `lotId`, and `applyFills` performs its own
   * internal FIFO. Buys, short-side closes, and `adjust` orders are never split.
   */
  lotMethod?: 'FIFO' | 'LIFO' | 'HIFO' | 'min-tax';
  /**
   * Short- and long-term capital-gains tax rates (as decimals, e.g. `0.37`)
   * forwarded to the `'min-tax'` selector. **Required** when
   * `lotMethod === 'min-tax'`; the constructor throws otherwise. Ignored for
   * all other lot methods.
   */
  taxRates?: { shortTerm: number; longTerm: number };
};

/**
 * Resolves the asset, net direction, quantity, and whether the order is a
 * long sell that {@link applyFills} consumes lots for — i.e. a `rebalance`
 * reduce (`delta < 0`) or a `close` of a long position. `lotConsumingSell` is
 * `false` for buys, short-side closes, and `adjust` orders.
 */
function resolveAsset(
  order: Order,
  portfolio: Portfolio,
): { asset: Asset; sign: 1 | -1; qty: number; lotConsumingSell: boolean } {
  switch (order.kind) {
    case 'open':
      return { asset: order.asset, sign: order.side === 'long' ? 1 : -1, qty: order.quantity, lotConsumingSell: false };
    case 'rebalance':
      return {
        asset: order.asset,
        sign: order.delta >= 0 ? 1 : -1,
        qty: Math.abs(order.delta),
        lotConsumingSell: order.delta < 0,
      };
    case 'close': {
      const p = portfolio.positions.find((x) => x.id === order.positionId);
      if (!p) throw new Error(`BacktestExecutor: close target position ${order.positionId} not found`);
      return {
        asset: p.asset,
        sign: p.side === 'long' ? -1 : 1,
        qty: order.quantity ?? p.quantity,
        lotConsumingSell: p.side === 'long',
      };
    }
    case 'adjust': {
      const p = portfolio.positions.find((x) => x.id === order.positionId);
      if (!p) throw new Error(`BacktestExecutor: adjust target position ${order.positionId} not found`);
      const target = order.changes.quantity ?? p.quantity;
      const delta = target - p.quantity;
      return { asset: p.asset, sign: delta >= 0 ? 1 : -1, qty: Math.abs(delta), lotConsumingSell: false };
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
 * **Lot selection**: by default each order yields exactly one fill. When a
 * non-default `lotMethod` (`'LIFO'` / `'HIFO'` / `'min-tax'`) is configured,
 * long sells (a `rebalance` reduce or a `close` of a long position) are split
 * into one fill per selected lot — each tagged with `Fill.lotId` — so
 * {@link applyFills} consumes those exact lots. See {@link BacktestExecutorOptions.lotMethod}.
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
  constructor(private readonly opts: BacktestExecutorOptions) {
    // `selectMinTax`'s context requires `rates`, and the call site passes
    // `this.opts.taxRates!` (non-null). This guard backs that assertion so a
    // 'min-tax' executor can never reach the selector with undefined rates.
    // (The current 4-tier ranking is rate-independent — it reads only the sign
    // of each lot's gain — but the selector's signature demands `rates`, and a
    // future rate-weighted variant would consume the magnitudes.)
    if (opts.lotMethod === 'min-tax' && !opts.taxRates) {
      throw new Error("BacktestExecutor: lotMethod 'min-tax' requires taxRates");
    }
  }

  async submit(orders: ReadonlyArray<Order>, t: Date, portfolio: Portfolio): Promise<ReadonlyArray<Fill>> {
    const fills: Fill[] = [];
    const slip = (this.opts.slippageBps ?? 0) / 10_000;
    const feePer = this.opts.perShareFee ?? 0;
    const method = this.opts.lotMethod;

    for (const order of orders) {
      const { asset, sign, qty, lotConsumingSell } = resolveAsset(order, portfolio);
      if (qty === 0) continue;
      const open = await this.opts.nextOpen(asset, t);
      const adjustedPrice = open.price * (1 + sign * slip);

      // Split path: only for long sells that applyFills consumes lots for, and
      // only under a non-default method. Emit one fill per selected lot so
      // applyFills honors `fill.lotId`. Buys / short closes / adjust never split.
      if (method && method !== 'FIFO' && lotConsumingSell) {
        const lots = (portfolio.lots ?? []).filter((l) => l.asset.id === asset.id && l.quantity > 0);
        if (lots.length > 0) {
          // A genuine oversell (lots present but summing to < qty) still throws
          // via the selector — matching applyFills' own oversell guard — so that
          // case is intentionally NOT suppressed; only the empty-lots case below
          // falls through.
          const slices: LotSlice[] =
            method === 'LIFO'
              ? selectLIFO(lots, qty)
              : method === 'HIFO'
                ? selectHIFO(lots, qty)
                : selectMinTax(lots, qty, { price: adjustedPrice, asOf: open.t, rates: this.opts.taxRates! });
          for (const slice of slices) {
            // Per-slice fee `feePer * slice.quantity` sums across slices to the
            // single-fill `feePer * qty` (the slice quantities partition qty), so
            // splitting adds no fees. In applyFills, consumeLots' pro-rata fee
            // term `(take / totalQty) * fees` collapses to `fees` for a one-lot
            // fill (take === totalQty === slice.quantity), giving proceeds of
            // `take * price - fees` with no double-count.
            fills.push({
              orderRef: order.id,
              t: open.t,
              quantity: slice.quantity,
              price: adjustedPrice,
              fees: feePer * slice.quantity,
              lotId: slice.lotId,
            });
          }
          continue;
        }
        // No lots for this asset: fall through to the single-fill push below.
        // Two downstream outcomes in applyFills, both correct:
        //  - Stray reduce on a non-held asset (positions also lacks it): the
        //    reduce branch's `idx >= 0` is false, so it no-ops and never calls
        //    consumeLots — matching the default path's tolerance of #37.
        //  - Position exists but lots don't (internal state inconsistency):
        //    applyFills reduces the position, then consumeLots throws RangeError
        //    (held 0 < qty). Fail-loud is the right outcome for a real state bug;
        //    in a clean run this can't happen (every long lot is created with its
        //    position in apply.ts). Either way, lotMethod never silently corrupts.
      }

      // Default single-fill path (byte-for-byte identical to pre-lotMethod
      // behavior): one fill per order, no `lotId`.
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
