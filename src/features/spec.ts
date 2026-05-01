import type { Series } from '../interfaces/types';
import { sma } from './indicators/sma';
import { ema } from './indicators/ema';
import { rsi } from './indicators/rsi';
import { returnSeries, type ReturnMode } from './indicators/return';
import { volatility } from './indicators/volatility';
import { drawdown } from './indicators/drawdown';

export type FeatureSpec =
  | { kind: 'price' }
  | { kind: 'sma'; period: number }
  | { kind: 'ema'; period: number }
  | { kind: 'rsi'; period: number }
  | { kind: 'return'; period: number; mode?: ReturnMode }
  | { kind: 'volatility'; period: number }
  | { kind: 'drawdown'; period: number };

export type FeatureKind = FeatureSpec['kind'];

type ComputeFn = (series: Series, spec: FeatureSpec) => Series;

const registry = new Map<FeatureKind, ComputeFn>();

export function defineFeature<K extends FeatureKind>(
  kind: K,
  compute: (series: Series, spec: Extract<FeatureSpec, { kind: K }>) => Series,
): void {
  if (registry.has(kind)) {
    throw new Error(`defineFeature: kind "${kind}" is already registered`);
  }
  registry.set(kind, compute as ComputeFn);
}

export function getFeatureCompute(kind: FeatureKind): ComputeFn {
  const fn = registry.get(kind);
  if (!fn) throw new Error(`getFeatureCompute: unknown feature kind "${kind}"`);
  return fn;
}

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
 * Callers depend on this function's contract (same logical content → same
 * result), not on the encoding. Future replacement with SHA-256 is
 * non-breaking.
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
