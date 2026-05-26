import type { AssetId } from '../interfaces/types';
import type { Portfolio } from '../portfolio/types';
import type { PriceMap, TargetWeights } from '../strategy/reconcile';

/**
 * Synthetic map key used to represent the cash allocation in weight maps
 * produced by {@link currentWeights} and consumed by {@link withinDriftBand}.
 *
 * The key `'_cash'` is reserved and must not be used as a real asset id.
 */
const CASH_KEY = '_cash' as AssetId;

/**
 * Compute the current portfolio weights from a {@link Portfolio} and a
 * {@link PriceMap}.
 *
 * Each asset weight equals `(lotQuantity × price) / total`, where `total` is
 * the sum of all priced lot values **plus** `portfolio.cash`. Lots whose asset
 * has no entry in `prices` are **skipped** — their value does not contribute
 * to `total` and they do not appear in the result.
 *
 * A synthetic `'_cash'` key is always included in the output with weight
 * `portfolio.cash / total`.
 *
 * **Fallback:** when `total <= 0` (e.g. empty portfolio, all lots unpriced,
 * and `cash === 0`) the function returns `new Map([['_cash', 1]])` to
 * represent a 100 % cash position and avoid division-by-zero.
 *
 * @param portfolio - The portfolio whose `lots` and `cash` are used.
 * @param prices    - Mark-to-market prices keyed by `AssetId`.
 * @returns         A `Map` from `AssetId` (plus the synthetic `'_cash'` key)
 *                  to fractional weights in the range `[0, 1]` summing to
 *                  approximately 1.
 */
export function currentWeights(portfolio: Portfolio, prices: PriceMap): Map<AssetId, number> {
  const byAsset = new Map<AssetId, number>();
  for (const lot of portfolio.lots ?? [])
    byAsset.set(lot.asset.id, (byAsset.get(lot.asset.id) ?? 0) + lot.quantity);

  let total = portfolio.cash;
  const values = new Map<AssetId, number>();
  for (const [id, qty] of byAsset) {
    const price = prices.get(id);
    if (price === undefined) continue;
    const v = qty * price;
    values.set(id, v);
    total += v;
  }

  if (total <= 0) return new Map([[CASH_KEY, 1]]);

  const out = new Map<AssetId, number>();
  for (const [id, v] of values) out.set(id, v / total);
  out.set(CASH_KEY, portfolio.cash / total);
  return out;
}

/**
 * Test whether a set of current portfolio weights is within a drift band of
 * a set of target weights.
 *
 * The check iterates over the union of all keys in `current`, `target`, and
 * the synthetic `'_cash'` key. For each key the target weight is:
 * - `target.get(k)` for non-cash keys (defaulting to `0` when absent).
 * - `max(0, 1 − Σ target values)` for the `'_cash'` key (the residual after
 *   all explicitly targeted asset weights are accounted for).
 *
 * Returns `false` as soon as `|current_k − target_k| >= band` for any key,
 * using **strict** `<` band semantics (i.e. equality at the boundary is
 * considered a drift violation). Returns `true` only if every key passes.
 *
 * @param current - Current weights, typically from {@link currentWeights}.
 * @param target  - Target asset weights (cash residual is implicit).
 * @param band    - Maximum allowed absolute deviation (exclusive); e.g. `0.05`
 *                  for a 5 % band.
 * @returns `true` iff every weight deviation is strictly less than `band`.
 */
export function withinDriftBand(
  current: ReadonlyMap<AssetId, number>,
  target: TargetWeights,
  band: number,
): boolean {
  const keys = new Set<AssetId>([...current.keys(), ...target.keys(), CASH_KEY]);
  const tgtSum = Array.from(target.values()).reduce((s, v) => s + v, 0);
  const targetCash = Math.max(0, 1 - tgtSum);

  for (const k of keys) {
    const c = current.get(k) ?? 0;
    const tw = k === CASH_KEY ? targetCash : (target.get(k) ?? 0);
    if (Math.abs(c - tw) >= band) return false;
  }
  return true;
}
