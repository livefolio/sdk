import type { Portfolio } from '../portfolio/types';
import type { Asset, AssetId } from '../interfaces/types';
import type { RebalanceOrder } from '../orders/types';

/**
 * Maps each asset ID to its desired portfolio weight as a fraction of total
 * portfolio value (e.g. `0.6` means 60 %). Weights need not sum to 1; any
 * residual becomes cash. Passing a weight of `0` or omitting an asset entirely
 * will generate a full exit order for any existing long position in that asset.
 */
export type TargetWeights = ReadonlyMap<AssetId, number>;

/**
 * Maps each asset ID to its current market price. Required for every asset that
 * appears in `TargetWeights` and for every asset currently held in the portfolio.
 * `reconcile` throws if a target asset has no corresponding price entry.
 */
export type PriceMap = ReadonlyMap<AssetId, number>;

/**
 * Converts target portfolio weights into a minimal set of `RebalanceOrder`
 * instructions that move the current portfolio toward the desired allocation.
 *
 * The algorithm:
 * 1. Compute total portfolio value as `cash + Σ(held_shares × price)`.
 * 2. For each target asset, derive `targetShares = floor(totalValue × weight / price)`.
 * 3. Emit a `RebalanceOrder` with `delta = targetShares - heldShares` for any
 *    asset where the delta is non-zero (positive = buy, negative = sell).
 * 4. Emit exit orders (`delta = -heldShares`) for any long position in an asset
 *    that does not appear in `targets`.
 *
 * Only long positions are considered — short positions in the portfolio are
 * ignored. Share counts are always floored to integer lots.
 *
 * @param targets - Desired weight per asset. Keys are `AssetId` strings. A weight
 *   of `0` is valid and will result in a full exit for any existing position.
 * @param portfolio - Current portfolio. Cash and long positions determine total
 *   value and existing share counts.
 * @param prices - Current prices for all assets that appear in `targets` or are
 *   currently held. Throws `Error` if a target asset is missing from this map.
 * @param assets - Optional canonical {@link Asset} metadata keyed by id. When
 *   `reconcile` needs to emit an order for an asset that is not yet held in the
 *   portfolio, it consults this map for the proper `symbol`/`kind`. If the
 *   asset is missing here too, the order falls back to a synthesized
 *   `{ kind: 'equity', id, symbol: id }` — lossless but display-unfriendly.
 * @returns A readonly array of `RebalanceOrder` objects. The array may be empty
 *   if the portfolio is already at the target allocation. Order IDs are
 *   deterministic within a single call (`rebal_<assetId>_<counter>`).
 *
 * @example
 * ```ts
 * import { reconcile } from '@livefolio/sdk';
 *
 * const targets = new Map([
 *   ['US:SPY', 0.6],
 *   ['US:BND', 0.4],
 * ]);
 * const prices = new Map([
 *   ['US:SPY', 440.0],
 *   ['US:BND', 75.0],
 * ]);
 *
 * // Empty portfolio with $100 000 cash
 * const portfolio = { cash: 100_000, positions: [] };
 * const orders = reconcile(targets, portfolio, prices);
 * // orders => [
 * //   { id: 'rebal_US:SPY_0', kind: 'rebalance', asset: { ... }, delta: 136 },
 * //   { id: 'rebal_US:BND_1', kind: 'rebalance', asset: { ... }, delta: 533 },
 * // ]
 * ```
 */
export function reconcile(
  targets: TargetWeights,
  portfolio: Portfolio,
  prices: PriceMap,
  assets?: ReadonlyMap<AssetId, Asset>,
): ReadonlyArray<RebalanceOrder> {
  const longByAsset = new Map<AssetId, { asset: Asset; quantity: number }>();
  for (const p of portfolio.positions) {
    if (p.side !== 'long') continue;
    const cur = longByAsset.get(p.asset.id);
    if (cur) cur.quantity += p.quantity;
    else longByAsset.set(p.asset.id, { asset: p.asset, quantity: p.quantity });
  }

  let totalValue = portfolio.cash;
  for (const { asset, quantity } of longByAsset.values()) {
    const price = prices.get(asset.id);
    if (price !== undefined) totalValue += quantity * price;
  }

  const orders: RebalanceOrder[] = [];
  let counter = 0;
  const nextId = (assetId: AssetId): string => `rebal_${assetId}_${counter++}`;

  const seen = new Set<AssetId>();

  for (const [assetId, weight] of targets) {
    const price = prices.get(assetId);
    if (price === undefined) {
      throw new Error(`reconcile: missing price for target asset ${assetId}`);
    }
    const targetShares = Math.floor((totalValue * weight) / price);
    const held = longByAsset.get(assetId);
    const currentShares = held?.quantity ?? 0;
    const delta = targetShares - currentShares;
    seen.add(assetId);
    if (delta !== 0) {
      const asset: Asset = held?.asset ??
        assets?.get(assetId) ?? {
          kind: 'equity',
          id: assetId,
          symbol: assetId,
        };
      orders.push({ id: nextId(assetId), kind: 'rebalance', asset, delta });
    }
  }

  for (const [assetId, { asset, quantity }] of longByAsset) {
    if (seen.has(assetId)) continue;
    orders.push({ id: nextId(assetId), kind: 'rebalance', asset, delta: -quantity });
  }

  return orders;
}
