import { createHash } from 'crypto';
import type { StrategyDraft } from './types';

export type CanonicalJson =
  | string
  | number
  | boolean
  | null
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

export interface LivefolioEnsureAdapterInput<TDefinition extends CanonicalJson> {
  definition: TDefinition;
  definitionHash: string;
  linkId: string;
}

export interface LivefolioEnsureAdapterResult {
  strategyId: number;
  linkId: string;
  created: boolean;
}

export interface LivefolioEnsureAdapter<TDefinition extends CanonicalJson> {
  ensureStrategy(input: LivefolioEnsureAdapterInput<TDefinition>): Promise<LivefolioEnsureAdapterResult>;
}

function normalizeCanonical(value: unknown): CanonicalJson {
  if (value === null) return null;

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Livefolio definition cannot include non-finite numbers.');
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCanonical(item));
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(obj).sort()) {
      const next = obj[key];
      if (next === undefined) continue;
      out[key] = normalizeCanonical(next);
    }
    return out;
  }

  throw new Error(`Unsupported value in livefolio definition: ${String(value)}`);
}

export function canonicalizeLivefolioDefinition<TDefinition extends CanonicalJson>(
  definition: TDefinition,
): CanonicalJson {
  return normalizeCanonical(definition);
}

export function hashLivefolioDefinition<TDefinition extends CanonicalJson>(definition: TDefinition): string {
  const canonical = canonicalizeLivefolioDefinition(definition);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function deriveLivefolioLinkId(definitionHash: string): string {
  if (!definitionHash || definitionHash.length < 12) {
    throw new Error('definitionHash must be at least 12 characters.');
  }
  return `lf-${definitionHash.slice(0, 12)}`;
}

export function hashLivefolioStrategyDraft(draft: StrategyDraft): string {
  return hashLivefolioDefinition(draft as unknown as CanonicalJson);
}

export async function ensureLivefolioStrategy<TDefinition extends CanonicalJson>(
  definition: TDefinition,
  adapter: LivefolioEnsureAdapter<TDefinition>,
): Promise<LivefolioEnsureAdapterResult & { definitionHash: string }> {
  const canonical = canonicalizeLivefolioDefinition(definition) as TDefinition;
  const definitionHash = hashLivefolioDefinition(canonical);
  const linkId = deriveLivefolioLinkId(definitionHash);
  const result = await adapter.ensureStrategy({
    definition: canonical,
    definitionHash,
    linkId,
  });

  return {
    ...result,
    definitionHash,
  };
}
