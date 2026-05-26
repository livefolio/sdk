import type { AssetId } from '../interfaces/types';
import type { Portfolio } from '../portfolio/types';
import type { PriceMap, TargetWeights } from '../strategy/reconcile';
import { currentWeights, withinDriftBand } from './drift-band';

/**
 * Tax account classification and rate configuration used by
 * {@link applyTaxPolicy} to determine whether tax-aware short-circuit logic
 * should be applied.
 *
 * - `accountType` — The tax wrapper for the account. Only `'taxable'` triggers
 *   the drift-band hold logic; `'ira'`, `'roth'`, and `'401k'` accounts have
 *   no immediate tax consequence for rebalancing, so the policy is bypassed.
 * - `shortTermRate` — Marginal rate applied to short-term capital gains
 *   (fractional; e.g. `0.37` for 37 %).
 * - `longTermRate` — Marginal rate applied to long-term capital gains
 *   (fractional; e.g. `0.2` for 20 %).
 * - `driftBand` — Optional drift-band configuration. When present, the policy
 *   checks whether the current portfolio is already within `threshold` of the
 *   target weights (see {@link withinDriftBand}). If it is, no trades are
 *   emitted (the current allocation is held). Omitting this field disables the
 *   short-circuit entirely.
 */
export type TaxPolicyConfig = {
  accountType: 'taxable' | 'ira' | 'roth' | '401k';
  shortTermRate: number;
  longTermRate: number;
  driftBand?: { threshold: number };
};

/**
 * Pre-pass that short-circuits rebalancing in taxable accounts when the
 * portfolio is already within the configured drift band of the target weights.
 *
 * **Behaviour:**
 * - Returns `targetWeights` unchanged (identity) when any of the following are
 *   true:
 *   - `config` is not provided.
 *   - `config.accountType` is not `'taxable'`.
 *   - `config.driftBand` is not set.
 * - When `config.accountType === 'taxable'` and `config.driftBand` is
 *   configured, computes the current portfolio weights via
 *   {@link currentWeights} and tests whether they are within
 *   `config.driftBand.threshold` of `targetWeights` using
 *   {@link withinDriftBand}.
 *   - If **within** the band → returns the current weights **with the
 *     synthetic `'_cash'` key removed**, representing a hold (no trades).
 *   - If **outside** the band → returns `targetWeights` unchanged so the
 *     downstream reconciler proceeds with the normal rebalance.
 *
 * @param targetWeights - The desired allocation from the strategy rule tree.
 * @param portfolio     - The current portfolio snapshot (lots + cash).
 * @param prices        - Mark-to-market prices keyed by {@link AssetId}.
 * @param _asOf         - Logical evaluation date. Currently unused; reserved
 *                        for future term-aware policy extensions. The leading
 *                        underscore satisfies the no-unused-vars lint rule.
 * @param config        - Optional tax policy configuration. When absent the
 *                        function is a no-op identity pass.
 * @returns A {@link TargetWeights} map — either the original `targetWeights`
 *          or the current held weights (without `'_cash'`).
 */
export function applyTaxPolicy(
  targetWeights: TargetWeights,
  portfolio: Portfolio,
  prices: PriceMap,
  _asOf: Date,
  config?: TaxPolicyConfig,
): TargetWeights {
  if (!config || config.accountType !== 'taxable' || !config.driftBand) return targetWeights;
  const current = currentWeights(portfolio, prices);
  if (withinDriftBand(current, targetWeights, config.driftBand.threshold)) {
    const stripped = new Map(current);
    stripped.delete('_cash' as AssetId);
    return stripped;
  }
  return targetWeights;
}
