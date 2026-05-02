import type { Asset, AssetId } from '../interfaces/types';
import type { Calendar } from '../interfaces/calendar';
import type { Strategy } from '../strategy/types';
import { reconcile } from '../strategy/reconcile';
import type { FeatureRuntime } from '../features/runtime';
import { seriesAt } from '../features/series-utils';
import type { AssetRef, RebalanceFrequency, RuleTreeState, TacticalSpec } from './types';
import { evaluateRuleTree } from './evaluate-rule-tree';
import { evaluateFeatureSpecs } from './evaluate-feature-specs';

export type TacticalFeatures = {
  values: ReadonlyMap<string, number | undefined>;
  prices: ReadonlyMap<AssetId, number>;
};

export type FromSpecOptions = {
  runtime: FeatureRuntime;
  calendar: Calendar;
};

function resolveAsset(ref: AssetRef): Asset {
  return ref.exchange !== undefined
    ? { kind: 'equity', id: ref.id, symbol: ref.symbol, exchange: ref.exchange }
    : { kind: 'equity', id: ref.id, symbol: ref.symbol };
}

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

export function isRebalanceDay(t: Date, freq: RebalanceFrequency, calendar: Calendar): boolean {
  if (freq === 'Daily') return true;
  const next = calendar.next(t);
  return periodKey(t, freq) !== periodKey(next, freq);
}

export function fromSpec(spec: TacticalSpec, opts: FromSpecOptions): Strategy<TacticalFeatures> {
  validateSynthetics(spec);
  const universe: ReadonlyArray<Asset> = spec.universe.map(resolveAsset);
  const { runtime, calendar } = opts;
  const cadence: RebalanceFrequency = spec.rebalance?.frequency ?? 'Daily';

  let state: RuleTreeState = new Map();

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

    build: (features, portfolio, t) => {
      if (!isRebalanceDay(t, cadence, calendar)) return [];

      const defined = new Map<string, number>();
      for (const [id, v] of features.values) {
        if (v !== undefined) defined.set(id, v);
      }
      let evaluated;
      try {
        evaluated = evaluateRuleTree(spec.rules, defined, state);
      } catch (e) {
        if (e instanceof Error && /has no value/.test(e.message)) return [];
        throw e;
      }
      state = evaluated.state;
      for (const assetId of evaluated.weights.keys()) {
        if (!features.prices.has(assetId)) return [];
      }
      return reconcile(evaluated.weights, portfolio, features.prices);
    },
  };
}
