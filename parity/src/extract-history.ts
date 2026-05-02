import type { StrategyBar } from '@livefolio/sdk';
import type { BacktestResult } from '@livefolio/sdk/strategy';
import type { FeatureRuntime } from '@livefolio/sdk/features';
import type { Calendar } from '@livefolio/sdk/interfaces';
import type { RuleTreeState, TacticalSpec } from '@livefolio/sdk/tactical';
import { evaluateFeatureSpecs, evaluateRuleTree, isRebalanceDay } from '@livefolio/sdk/tactical';

export type AllocationDay = {
  readonly date: string; // 'YYYY-MM-DD' (UTC)
  readonly weights: Readonly<Record<string, number>>;
};

export type AllocationHistory = ReadonlyArray<AllocationDay>;

export type SymbolToAssetId = (symbol: string) => string;

const defaultMapper: SymbolToAssetId = (s) => `us:${s}`;

/**
 * Extract per-day target weights from a v0.3 StrategyBar[]. Reads
 * `bar.allocation.holdings` (a `[TickerHandle, number][]`). Drops CASHX.
 * Renormalizes the remaining weights to sum to 1.0 (defensive — v0.3
 * allocations are typically already normalized excluding cash).
 *
 * Caller obtains bars via `await strategy.series({ from, to })`.
 */
export function extractV3History(
  bars: ReadonlyArray<StrategyBar>,
  symbolToAssetId: SymbolToAssetId = defaultMapper,
): AllocationHistory {
  const out: AllocationDay[] = [];
  for (const bar of bars) {
    const weights: Record<string, number> = {};
    let total = 0;
    for (const [ticker, w] of bar.allocation.holdings) {
      if (ticker.symbol === 'CASHX') continue;
      const id = symbolToAssetId(ticker.symbol);
      weights[id] = (weights[id] ?? 0) + w;
      total += w;
    }
    if (total > 0 && Math.abs(total - 1) > 1e-9) {
      for (const k of Object.keys(weights)) weights[k] = weights[k]! / total;
    }
    out.push({ date: bar.date, weights });
  }
  return out;
}

/**
 * Extract per-day REALIZED weights from a v0.4 BacktestResult. For each
 * snapshot, computes value of each position at `priceAt(assetId, date)` and
 * divides by total non-cash value. Cash is excluded.
 *
 * NOTE: This reads market-value weights — they drift between rebalances. For
 * parity comparison against v0.3 (which emits TARGET weights), prefer
 * `extractV4TargetHistory`.
 */
export function extractV4History(
  result: BacktestResult,
  priceAt: (assetId: string, date: string) => number,
): AllocationHistory {
  const out: AllocationDay[] = [];
  for (const snap of result.snapshots) {
    const date = snap.t.toISOString().slice(0, 10);
    const values: Record<string, number> = {};
    let total = 0;
    for (const pos of snap.portfolio.positions) {
      const px = priceAt(pos.asset.id, date);
      const v = pos.quantity * px;
      values[pos.asset.id] = (values[pos.asset.id] ?? 0) + v;
      total += v;
    }
    const weights: Record<string, number> = {};
    if (total > 0) {
      for (const [k, v] of Object.entries(values)) weights[k] = v / total;
    }
    out.push({ date, weights });
  }
  return out;
}

export type ExtractV4TargetOptions = {
  readonly result: BacktestResult;
  readonly spec: TacticalSpec;
  readonly runtime: FeatureRuntime;
  readonly calendar: Calendar;
};

/**
 * Extract per-day TARGET weights from a v0.4 BacktestResult by re-evaluating
 * the rule tree at each snapshot date. On rebalance days, the rule tree is
 * evaluated with current features and the result becomes the target. On
 * non-rebalance days, the prior target is carried forward (mirroring v0.3
 * Strategy semantics).
 *
 * Snapshots before the first valid rebalance evaluation (e.g. during feature
 * warmup, where SMA200 has no value yet) emit empty weights — equivalent to
 * v0.3 dropping those bars entirely.
 *
 * This is the methodology used by the parity gate: compares TARGET-vs-TARGET
 * across the two engines instead of TARGET-vs-REALIZED.
 */
export async function extractV4TargetHistory(opts: ExtractV4TargetOptions): Promise<AllocationHistory> {
  const { result, spec, runtime, calendar } = opts;
  const cadence = spec.rebalance?.frequency ?? 'Daily';
  let state: RuleTreeState = new Map();
  let lastTarget: Record<string, number> | undefined;

  const out: AllocationDay[] = [];
  for (const snap of result.snapshots) {
    const date = snap.t.toISOString().slice(0, 10);
    if (isRebalanceDay(snap.t, cadence, calendar)) {
      const values = await evaluateFeatureSpecs(spec.features, runtime, snap.t);
      const defined = new Map<string, number>();
      let allDefined = true;
      for (const featureSpec of spec.features) {
        const v = values.get(featureSpec.id);
        if (v === undefined) {
          allDefined = false;
          break;
        }
        defined.set(featureSpec.id, v);
      }
      if (allDefined) {
        try {
          const evaluated = evaluateRuleTree(spec.rules, defined, state);
          state = evaluated.state;
          const next: Record<string, number> = {};
          for (const [assetId, w] of evaluated.weights) next[assetId] = w;
          lastTarget = next;
        } catch (e) {
          if (!(e instanceof Error && /has no value/.test(e.message))) throw e;
          // else: leave lastTarget unchanged (warmup miss)
        }
      }
    }
    out.push({ date, weights: lastTarget ? { ...lastTarget } : {} });
  }
  return out;
}
