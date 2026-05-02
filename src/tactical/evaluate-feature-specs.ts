import type { Asset, Series } from '../interfaces/types';
import type { FeatureSpec } from '../features/spec';
import type { FeatureRuntime } from '../features/runtime';
import type { AssetRef, TacticalFeatureSpec } from './types';

function resolveAsset(ref: AssetRef): Asset {
  return ref.exchange !== undefined
    ? { kind: 'equity', id: ref.id, symbol: ref.symbol, exchange: ref.exchange }
    : { kind: 'equity', id: ref.id, symbol: ref.symbol };
}

function toFeatureSpec(spec: TacticalFeatureSpec): FeatureSpec {
  switch (spec.kind) {
    case 'price':
      return { kind: 'price' };
    case 'sma':
      return { kind: 'sma', period: spec.period };
    case 'ema':
      return { kind: 'ema', period: spec.period };
    case 'rsi':
      return { kind: 'rsi', period: spec.period };
    case 'return':
      return spec.mode !== undefined
        ? { kind: 'return', period: spec.period, mode: spec.mode }
        : { kind: 'return', period: spec.period };
    case 'volatility':
      return { kind: 'volatility', period: spec.period };
    case 'drawdown':
      return { kind: 'drawdown', period: spec.period };
  }
}

function indexAtOrBefore(series: Series, t: Date): number {
  if (series.length === 0) return -1;
  const target = t.getTime();
  let lo = 0;
  let hi = series.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (series[mid]!.t.getTime() <= target) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function readDelayed(series: Series, t: Date, delay: number): number | undefined {
  const idx = indexAtOrBefore(series, t);
  if (idx < 0) return undefined;
  const target = idx - delay;
  if (target < 0) return undefined;
  return series[target]!.v;
}

/**
 * Resolves each {@link TacticalFeatureSpec} in `specs` to a scalar value as of
 * date `t` by calling into `runtime` and reading the series at the appropriate
 * bar index. All specs are computed in parallel via `Promise.all`.
 *
 * The returned map uses each spec's `id` as the key. The value is `undefined`
 * when the indicator series has no data on or before `t`, or when the `delay`
 * offset steps past the beginning of the series.
 *
 * Validation performed before dispatching to the runtime:
 * - Duplicate `id` values in `specs` throw immediately.
 * - A non-integer or negative `delay` throws immediately.
 *
 * @param specs   - Ordered list of feature declarations from {@link TacticalSpec.features}.
 * @param runtime - Feature computation backend that owns the data feed and cache.
 * @param t       - Evaluation date; the series is read at the latest bar on or before `t`.
 * @returns A map from feature id to resolved numeric value (`undefined` when unavailable).
 *
 * @example
 * ```ts
 * import { evaluateFeatureSpecs } from '@livefolio/sdk';
 * import type { TacticalFeatureSpec } from '@livefolio/sdk';
 *
 * const specs: TacticalFeatureSpec[] = [
 *   { id: 'spy_sma200', kind: 'sma', asset: { id: 'SPY', symbol: 'SPY' }, period: 200 },
 *   { id: 'spy_price',  kind: 'price', asset: { id: 'SPY', symbol: 'SPY' } },
 * ];
 *
 * const values = await evaluateFeatureSpecs(specs, runtime, new Date('2024-06-01'));
 * // values.get('spy_price') → 528.3
 * ```
 */
export async function evaluateFeatureSpecs(
  specs: ReadonlyArray<TacticalFeatureSpec>,
  runtime: FeatureRuntime,
  t: Date,
): Promise<Map<string, number | undefined>> {
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.id)) {
      throw new Error(`evaluateFeatureSpecs: duplicate feature id "${spec.id}"`);
    }
    seen.add(spec.id);
    const d = spec.delay;
    if (d !== undefined && (!Number.isInteger(d) || d < 0)) {
      throw new Error(`evaluateFeatureSpecs: delay must be a non-negative integer, got ${d}`);
    }
  }

  const entries = await Promise.all(
    specs.map(async (spec) => {
      const series = await runtime.compute(toFeatureSpec(spec), resolveAsset(spec.asset));
      const delay = spec.delay ?? 0;
      return [spec.id, readDelayed(series, t, delay)] as const;
    }),
  );

  return new Map(entries);
}
