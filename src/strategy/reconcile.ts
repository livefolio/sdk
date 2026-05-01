import type { Portfolio } from '../portfolio/types';
import type { Asset, AssetId } from '../interfaces/types';
import type { RebalanceOrder } from '../orders/types';

export type TargetWeights = ReadonlyMap<AssetId, number>;
export type PriceMap = ReadonlyMap<AssetId, number>;

export function reconcile(
  targets: TargetWeights,
  portfolio: Portfolio,
  prices: PriceMap,
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
      const asset: Asset = held?.asset ?? {
        kind: 'equity',
        id: assetId,
        symbol: assetId.split(':').pop() ?? assetId,
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
