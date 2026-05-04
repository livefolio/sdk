import type { Asset } from '../interfaces/types';
import type { AssetRef } from './types';

/**
 * Resolves a spec-form {@link AssetRef} to a runtime {@link Asset}. The
 * `kind` field on the ref selects the variant; absent `kind` defaults to
 * `'equity'` for backward compatibility.
 *
 * Pure. No I/O. Used by `fromSpec`, `withSynthetics`, and
 * `evaluateFeatureSpecs` so the resolution rule lives in one place.
 */
export function resolveAssetRef(ref: AssetRef): Asset {
  if (ref.kind === 'macro') {
    return { kind: 'macro', id: ref.id, symbol: ref.symbol };
  }
  return ref.exchange !== undefined
    ? { kind: 'equity', id: ref.id, symbol: ref.symbol, exchange: ref.exchange }
    : { kind: 'equity', id: ref.id, symbol: ref.symbol };
}
