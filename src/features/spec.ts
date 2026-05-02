import type { Series } from '../interfaces/types';
import { sma } from './indicators/sma';
import { ema } from './indicators/ema';
import { rsi } from './indicators/rsi';
import { returnSeries, type ReturnMode } from './indicators/return';
import { volatility } from './indicators/volatility';
import { drawdown } from './indicators/drawdown';

/**
 * A discriminated union describing every built-in feature kind and its parameters.
 *
 * Each variant has a `kind` field that identifies the indicator together with the
 * parameters that fully determine its output. `FeatureSpec` objects are used as
 * cache keys (via `paramsHash`) and as dispatch tokens (via `getFeatureCompute`).
 *
 * Variants:
 * - `{ kind: 'price' }` — raw price series; no parameters.
 * - `{ kind: 'sma'; period: number }` — simple moving average over `period` bars.
 * - `{ kind: 'ema'; period: number }` — exponential moving average seeded from an SMA.
 * - `{ kind: 'rsi'; period: number }` — Wilder's Relative Strength Index.
 * - `{ kind: 'return'; period: number; mode?: ReturnMode }` — period return; percent or absolute.
 * - `{ kind: 'volatility'; period: number }` — rolling population standard deviation of daily returns.
 * - `{ kind: 'drawdown'; period: number }` — drawdown relative to the rolling maximum.
 */
export type FeatureSpec =
  | { kind: 'price' }
  | { kind: 'sma'; period: number }
  | { kind: 'ema'; period: number }
  | { kind: 'rsi'; period: number }
  | { kind: 'return'; period: number; mode?: ReturnMode }
  | { kind: 'volatility'; period: number }
  | { kind: 'drawdown'; period: number };

/**
 * String literal union of all valid feature `kind` values derived from `FeatureSpec`.
 *
 * Useful for typing registry keys and dispatch tables without manually listing all
 * variants: `'price' | 'sma' | 'ema' | 'rsi' | 'return' | 'volatility' | 'drawdown'`.
 */
export type FeatureKind = FeatureSpec['kind'];

type ComputeFn = (series: Series, spec: FeatureSpec) => Series;

const registry = new Map<FeatureKind, ComputeFn>();

/**
 * Registers a compute function for a new or existing feature kind.
 *
 * Throws if `kind` is already registered. Call this once at module initialisation
 * time (top-level) to extend the built-in feature registry with custom indicators.
 * The compute function receives the raw price `Series` and the full typed spec
 * object for that kind; it must return a `Series` of the same or shorter length.
 *
 * @param kind - The `FeatureKind` string that identifies this indicator.
 * @param compute - Pure function that transforms a price series according to `spec`.
 *   The `spec` argument is narrowed to `Extract<FeatureSpec, { kind: K }>` so
 *   TypeScript enforces that only the correct parameter shape is accessed.
 * @returns `void`. Registration is a side-effectful, one-time operation.
 *
 * @example
 * ```ts
 * import { defineFeature } from '@livefolio/sdk';
 *
 * // Register a custom 'zscore' feature kind
 * defineFeature('sma', (series, spec) => {
 *   // Already built-in; this would throw due to duplicate registration.
 *   // Shown here for illustration only.
 *   return series;
 * });
 * ```
 */
export function defineFeature<K extends FeatureKind>(
  kind: K,
  compute: (series: Series, spec: Extract<FeatureSpec, { kind: K }>) => Series,
): void {
  if (registry.has(kind)) {
    throw new Error(`defineFeature: kind "${kind}" is already registered`);
  }
  registry.set(kind, compute as ComputeFn);
}

/**
 * Retrieves the registered compute function for a given feature kind.
 *
 * Throws `Error` if the kind has not been registered. In normal usage the
 * built-in `defineFeature` calls at the bottom of this module pre-populate the
 * registry, so this function only throws for custom kinds that were never registered.
 *
 * @param kind - The `FeatureKind` string to look up.
 * @returns The `ComputeFn` registered for `kind`.
 *
 * @example
 * ```ts
 * import { getFeatureCompute } from '@livefolio/sdk';
 *
 * const computeSma = getFeatureCompute('sma');
 * const result = computeSma(priceSeries, { kind: 'sma', period: 20 });
 * ```
 */
export function getFeatureCompute(kind: FeatureKind): ComputeFn {
  const fn = registry.get(kind);
  if (!fn) throw new Error(`getFeatureCompute: unknown feature kind "${kind}"`);
  return fn;
}

/**
 * Recursive canonicalization: sort object keys, skip undefined values,
 * preserve null + array order, recurse into nested objects.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    if (obj[k] === undefined) continue;
    sorted[k] = canonicalize(obj[k]);
  }
  return sorted;
}

/**
 * Returns a deterministic string that depends only on the spec's logical
 * content — key order and undefined optional fields are normalized away.
 *
 * The same logical spec always produces the same hash regardless of how the
 * object was constructed (different key insertion order, explicit `undefined`
 * vs. omitted optional field). This string is used as the `paramsHash` field
 * in `FeatureKey` to ensure cache-hit equivalence for semantically identical
 * specs.
 *
 * Callers depend on this function's contract (same logical content → same
 * result), not on the encoding. Future replacement with SHA-256 is
 * non-breaking.
 *
 * @param spec - The `FeatureSpec` object to hash.
 * @returns A JSON string with sorted keys and no undefined values.
 *
 * @example
 * ```ts
 * import { paramsHash } from '@livefolio/sdk';
 *
 * paramsHash({ kind: 'sma', period: 20 });
 * // => '{"kind":"sma","period":20}'
 *
 * // Optional field omitted vs explicitly undefined — same result:
 * paramsHash({ kind: 'return', period: 10 });
 * paramsHash({ kind: 'return', period: 10, mode: undefined });
 * // both => '{"kind":"return","period":10}'
 * ```
 */
export function paramsHash(spec: FeatureSpec): string {
  return JSON.stringify(canonicalize(spec));
}

defineFeature('price', (series) => series);
defineFeature('sma', (series, spec) => sma(series, spec.period));
defineFeature('ema', (series, spec) => ema(series, spec.period));
defineFeature('rsi', (series, spec) => rsi(series, spec.period));
defineFeature('return', (series, spec) => returnSeries(series, spec.period, spec.mode));
defineFeature('volatility', (series, spec) => volatility(series, spec.period));
defineFeature('drawdown', (series, spec) => drawdown(series, spec.period));
