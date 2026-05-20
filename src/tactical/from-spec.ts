import type { Asset, AssetId } from '../interfaces/types';
import type { Calendar } from '../interfaces/calendar';
import type { Strategy } from '../strategy/types';
import { reconcile } from '../strategy/reconcile';
import type { FeatureRuntime } from '../features/runtime';
import { seriesAt } from '../features/series-utils';
import type { RebalanceFrequency, RuleTreeState, TacticalSpec } from './types';
import { resolveAssetRef } from './asset-ref';
import { evaluateRuleTree } from './evaluate-rule-tree';
import { evaluateFeatureSpecs } from './evaluate-feature-specs';

let _warnedV0 = false;

/** Test-only: reset the once-per-process deprecation gate. */
export function _resetTacticalDeprecationWarningForTesting(): void {
  _warnedV0 = false;
}

/**
 * The feature bundle computed on each rebalance step and passed to the rule
 * tree. Produced by the `features` method of the {@link Strategy} returned by
 * {@link fromSpec}.
 *
 * - `values` — named indicator results keyed by the `id` field of each
 *   {@link TacticalFeatureSpec}. A value is `undefined` when the indicator
 *   cannot be computed for that bar (e.g. insufficient history).
 * - `prices` — most-recent closing prices for each asset in the universe,
 *   keyed by asset ID.
 */
export type TacticalFeatures = {
  values: ReadonlyMap<string, number | undefined>;
  prices: ReadonlyMap<AssetId, number>;
};

/**
 * Runtime dependencies required by {@link fromSpec} to hydrate a
 * {@link TacticalSpec} into a runnable {@link Strategy}.
 */
export type FromSpecOptions = {
  /** Feature computation backend — wraps the data feed and caching layer. */
  runtime: FeatureRuntime;
  /** Exchange calendar used to gate rebalance days via {@link isRebalanceDay}. */
  calendar: Calendar;
};

function validateSynthetics(spec: TacticalSpec): void {
  const synths = spec.synthetics ?? [];
  if (synths.length === 0) return;

  const universeIds = new Set(spec.universe.map((u) => u.id));

  for (const s of synths) {
    if (s.underlying.id === s.id) {
      throw new Error(`fromSpec: synthetic asset "${s.id}" cannot reference itself as underlying`);
    }
    const u = spec.universe.find((x) => x.id === s.id);
    if (!u) continue;
    if (u.symbol !== s.symbol) {
      throw new Error(`fromSpec: synthetic asset id "${s.id}" collides with a universe AssetRef of a different symbol`);
    }
    if (!universeIds.has(s.underlying.id)) {
      throw new Error(
        `fromSpec: synthetic asset id "${s.id}" collides with a universe AssetRef whose underlying is not declared in the universe`,
      );
    }
  }
}

/**
 * Returns a stable string key that identifies the rebalance period containing
 * date `t` for the given `freq`. Two dates that map to the same key belong to
 * the same period and therefore produce the same rebalance decision. Used
 * internally by {@link isRebalanceDay} to detect period boundaries.
 *
 * @param t    - The date to classify.
 * @param freq - Rebalance cadence (see {@link RebalanceFrequency}).
 * @returns A compact string such as `'2024-3'` (monthly), `'2024-W14'`
 *   (weekly), or `'2024-1'` (quarterly Q2).
 */
export function periodKey(t: Date, freq: RebalanceFrequency): string {
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  switch (freq) {
    case 'Daily':
      return `${y}-${m}-${t.getUTCDate()}`;
    case 'Weekly': {
      const thu = new Date(t);
      thu.setUTCDate(thu.getUTCDate() + 3 - ((thu.getUTCDay() + 6) % 7));
      const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
      return `${thu.getUTCFullYear()}-W${weekNo}`;
    }
    case 'Monthly':
      return `${y}-${m}`;
    case 'Quarterly':
      return `${y}-Q${Math.floor(m / 3)}`;
    case 'Yearly':
      return `${y}`;
  }
}

/**
 * Returns `true` when `t` is the last trading day of its rebalance period
 * according to `freq` and `calendar`. The check is: `periodKey(t) !== periodKey(next(t))`.
 * For `'Daily'` cadence this always returns `true`.
 *
 * @param t        - Current trading day (must itself be a trading day).
 * @param freq     - Rebalance cadence (see {@link RebalanceFrequency}).
 * @param calendar - Exchange calendar used to find the next trading day.
 * @returns `true` if today is the last day of its period and orders should be issued.
 */
export function isRebalanceDay(t: Date, freq: RebalanceFrequency, calendar: Calendar): boolean {
  if (freq === 'Daily') return true;
  const next = calendar.next(t);
  return periodKey(t, freq) !== periodKey(next, freq);
}

/**
 * Hydrates a plain {@link TacticalSpec} data object into a runnable
 * {@link Strategy} that `runBacktest` can drive step-by-step.
 *
 * State is threaded explicitly through `build` via the
 * {@link Strategy | `Strategy<F, S>.build`} signature. `initialState()` returns
 * an empty {@link RuleTreeState} Map; the runtime is responsible for storing and
 * forwarding the state between calls. This design makes `build` a pure function
 * of its inputs — calling it twice with identical arguments produces identical
 * outputs, enabling snapshot/restore for preview-builds in live mode.
 *
 * Validation performed at construction time:
 * - A `'tactical/v0'` `kind` emits a one-time deprecation warning to `console.warn`.
 * - Synthetic assets are checked for self-reference, symbol collisions, and
 *   missing universe entries (see internal `validateSynthetics`).
 *
 * @param spec - The declarative strategy spec.
 * @param opts - Runtime dependencies (feature backend and calendar).
 * @returns A {@link Strategy} whose `features` method fetches indicator values
 *   and whose `build` method converts them to rebalance orders.
 *
 * @example
 * ```ts
 * import { fromSpec, MemoryFeatureCache, NYSEExchangeCalendar } from '@livefolio/sdk';
 * import { FeatureRuntime } from '@livefolio/sdk/features';
 *
 * const calendar = new NYSEExchangeCalendar();
 * const cache    = new MemoryFeatureCache();
 * const runtime  = new FeatureRuntime({ feed: myDataFeed, cache });
 *
 * const strategy = fromSpec(mySpec, { runtime, calendar });
 * ```
 */
export function fromSpec(spec: TacticalSpec, opts: FromSpecOptions): Strategy<TacticalFeatures, RuleTreeState> {
  if (spec.kind === 'tactical/v0' && !_warnedV0) {
    _warnedV0 = true;

    console.warn(
      '[@livefolio/sdk] tactical/v0 is deprecated; migrate to tactical/v1. ' +
        'The two are byte-for-byte equivalent. This warning fires once per process.',
    );
  }
  validateSynthetics(spec);
  const universe: ReadonlyArray<Asset> = spec.universe.map(resolveAssetRef);
  const assetsById = new Map<AssetId, Asset>();
  for (const a of universe) assetsById.set(a.id, a);
  for (const s of spec.synthetics ?? []) {
    if (!assetsById.has(s.id)) {
      assetsById.set(s.id, { kind: 'equity', id: s.id, symbol: s.symbol });
    }
  }
  const { runtime, calendar } = opts;
  const cadence: RebalanceFrequency = spec.rebalance?.frequency ?? 'Daily';

  return {
    universe: () => universe,

    features: async (_u, _p, t) => {
      const [values, priceEntries] = await Promise.all([
        evaluateFeatureSpecs(spec.features, runtime, t),
        Promise.all(
          universe.map(async (asset) => {
            const s = await runtime.compute({ kind: 'price' }, asset);
            return [asset.id, seriesAt(s, t)] as const;
          }),
        ),
      ]);
      const prices = new Map<AssetId, number>();
      for (const [id, v] of priceEntries) {
        if (v !== undefined) prices.set(id, v);
      }
      return { values, prices };
    },

    initialState: () => new Map() as RuleTreeState,

    build: (features, portfolio, state, t) => {
      if (!isRebalanceDay(t, cadence, calendar)) {
        return { orders: [], state };
      }

      const defined = new Map<string, number>();
      for (const [id, v] of features.values) {
        if (v !== undefined) defined.set(id, v);
      }
      let evaluated;
      try {
        evaluated = evaluateRuleTree(spec.rules, defined, state);
      } catch (e) {
        if (e instanceof Error && /has no value/.test(e.message)) {
          return { orders: [], state };
        }
        throw e;
      }
      for (const assetId of evaluated.weights.keys()) {
        if (!features.prices.has(assetId)) {
          return { orders: [], state };
        }
      }
      return {
        orders: reconcile(evaluated.weights, portfolio, features.prices, assetsById),
        state: evaluated.state,
      };
    },
  };
}
