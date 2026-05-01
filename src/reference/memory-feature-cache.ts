import type { FeatureCache, FeatureKey } from '../interfaces/feature-cache';
import type { Series } from '../interfaces/types';

function canonicalKey(key: FeatureKey): string {
  const scopePart = key.scope.kind === 'asset' ? `asset:${key.scope.asset}` : `universe:${key.scope.universeHash}`;
  return [
    `feat=${key.feature}`,
    `params=${key.paramsHash}`,
    `scope=${scopePart}`,
    `from=${key.range.from.toISOString()}`,
    `to=${key.range.to.toISOString()}`,
    `freq=${key.freq}`,
  ].join('|');
}

function canonicalPrefix(prefix: Partial<FeatureKey>): string {
  const parts: string[] = [];
  if (prefix.feature !== undefined) parts.push(`feat=${prefix.feature}`);
  if (prefix.paramsHash !== undefined) parts.push(`params=${prefix.paramsHash}`);
  if (prefix.scope !== undefined) {
    const scopePart =
      prefix.scope.kind === 'asset' ? `asset:${prefix.scope.asset}` : `universe:${prefix.scope.universeHash}`;
    parts.push(`scope=${scopePart}`);
  }
  if (prefix.range !== undefined) {
    parts.push(`from=${prefix.range.from.toISOString()}`);
    parts.push(`to=${prefix.range.to.toISOString()}`);
  }
  if (prefix.freq !== undefined) parts.push(`freq=${prefix.freq}`);
  return parts.join('|');
}

/**
 * In-process Map-backed FeatureCache. No eviction. Suitable for
 * single-run backtests; replace with a persistent impl for hosted use.
 */
export class MemoryFeatureCache implements FeatureCache {
  private store = new Map<string, Series>();

  async get(key: FeatureKey): Promise<Series | undefined> {
    return this.store.get(canonicalKey(key));
  }

  async set(key: FeatureKey, series: Series): Promise<void> {
    this.store.set(canonicalKey(key), series);
  }

  async invalidate(prefix: Partial<FeatureKey>): Promise<void> {
    const needles = canonicalPrefix(prefix).split('|').filter(Boolean);
    if (needles.length === 0) return;
    for (const k of [...this.store.keys()]) {
      if (needles.every((n) => k.includes(n))) this.store.delete(k);
    }
  }
}
