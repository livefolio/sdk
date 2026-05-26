import type { AssetId } from '../interfaces/types';
import type { Portfolio } from '../portfolio/types';
import type { PriceMap, TargetWeights } from '../strategy/reconcile';

const MS_PER_DAY = 86_400_000;

/**
 * Configuration for the opt-in tax-loss-harvesting pre-pass.
 *
 * - `enabled` — Master switch. When `false`, {@link applyTaxLossHarvesting}
 *   is a no-op identity pass regardless of the other fields.
 * - `minLossThreshold` — Minimum aggregate unrealized loss (in base-currency
 *   units) an asset must have before a harvest swap is triggered. Losses
 *   below this threshold are left alone.
 * - `cooldownDays` — Wash-sale guard window in calendar days. If
 *   `recentBuyHistory` contains a buy of the same asset within this many days
 *   of `asOf`, the swap is skipped to avoid a disallowed wash-sale loss.
 *   A buy on exactly `asOf − cooldownDays` is considered **within** the window
 *   (i.e. the comparison is `>=`).
 * - `swapPairs` — Map from asset ID to its wash-safe substitute. Only assets
 *   that appear as a key in this record are eligible for harvesting. The value
 *   is the target asset ID that will receive the harvested weight.
 */
export type TLHConfig = {
  enabled: boolean;
  minLossThreshold: number;
  cooldownDays: number;
  swapPairs: Record<string, string>;
};

/**
 * Output of {@link applyTaxLossHarvesting}.
 *
 * - `weights` — The (potentially modified) {@link TargetWeights} map. For each
 *   harvested asset, its weight has been moved to the swap target; the original
 *   key is removed. Assets that were not harvested appear unchanged.
 * - `swaps` — The list of swaps that were performed. Each entry records the
 *   `from` asset (the one being harvested), the `to` asset (the wash-safe
 *   substitute), and the `expectedLoss` (the aggregate unrealized loss in
 *   base-currency units that motivated the swap).
 */
export type TLHResult = {
  weights: TargetWeights;
  swaps: Array<{ from: AssetId; to: AssetId; expectedLoss: number }>;
};

/**
 * Opt-in tax-loss-harvesting pre-pass.
 *
 * When `config.enabled` is `true`, this function inspects each tax lot in
 * `portfolio.lots` to identify assets with aggregate unrealized losses above
 * `config.minLossThreshold`. For each qualifying asset, if the caller has
 * registered a wash-safe swap target in `config.swapPairs` and no entry in
 * `recentBuyHistory` for that asset falls within the `cooldownDays` window,
 * the asset's target weight is moved to the swap target and a swap record is
 * appended to `TLHResult.swaps`.
 *
 * **Identity cases** — the function returns `{ weights, swaps: [] }` unchanged
 * (same `weights` reference) when:
 * - `config.enabled` is `false`.
 *
 * **Per-asset skip conditions:**
 * - The aggregate loss for that asset is below `config.minLossThreshold`.
 * - There is no `config.swapPairs` entry for the asset.
 * - `recentBuyHistory` contains an entry for the asset with `t >= asOf −
 *   cooldownDays` (wash-sale risk).
 * - The asset's target weight is `<= 0` (nothing to move).
 *
 * @param weights          - The desired allocation produced by the rule tree.
 *   Treated as immutable; a new {@link TargetWeights} `Map` is returned.
 * @param portfolio        - Current portfolio snapshot. `portfolio.lots` is the
 *   source of cost-basis data; assets without lots or prices are ignored.
 * @param prices           - Mark-to-market prices keyed by {@link AssetId}. Lots
 *   whose asset has no price entry are skipped (loss cannot be computed).
 * @param asOf             - Logical evaluation date used as the reference point
 *   for the `cooldownDays` wash-sale window.
 * @param config           - TLH configuration (enabled flag, threshold, cooldown,
 *   and swap pairs).
 * @param recentBuyHistory - Optional log of recent purchases used to detect
 *   wash-sale risk. Each entry is `{ assetId, t }` where `t` is the buy date.
 *   A buy with `t >= asOf − cooldownDays` blocks the harvest swap for that
 *   asset. Defaults to `[]` when omitted.
 * @returns A {@link TLHResult} containing the (possibly modified) weights map
 *   and the list of swaps that were performed.
 */
export function applyTaxLossHarvesting(
  weights: TargetWeights,
  portfolio: Portfolio,
  prices: PriceMap,
  asOf: Date,
  config: TLHConfig,
  recentBuyHistory: ReadonlyArray<{ assetId: AssetId; t: Date }> = [],
): TLHResult {
  if (!config.enabled) return { weights, swaps: [] };
  const lossByAsset = new Map<AssetId, number>();
  for (const lot of portfolio.lots ?? []) {
    const price = prices.get(lot.asset.id);
    if (price === undefined) continue;
    const loss = lot.basis - lot.quantity * price;
    if (loss > 0) lossByAsset.set(lot.asset.id, (lossByAsset.get(lot.asset.id) ?? 0) + loss);
  }
  const out = new Map(weights);
  const swaps: TLHResult['swaps'] = [];
  const cut = asOf.getTime() - config.cooldownDays * MS_PER_DAY;
  for (const [assetId, loss] of lossByAsset) {
    if (loss < config.minLossThreshold) continue;
    const swapTo = config.swapPairs[assetId];
    if (!swapTo) continue;
    if (recentBuyHistory.some((b) => b.assetId === assetId && b.t.getTime() >= cut)) continue;
    const w = out.get(assetId) ?? 0;
    if (w <= 0) continue;
    out.set(swapTo as AssetId, (out.get(swapTo as AssetId) ?? 0) + w);
    out.delete(assetId);
    swaps.push({ from: assetId, to: swapTo as AssetId, expectedLoss: loss });
  }
  return { weights: out, swaps };
}
