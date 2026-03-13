import type { TypedSupabaseClient } from '../types';
import type { Strategy, StrategyDraft } from './types';
import { compileRules } from './rules';
import {
  ensureLivefolioStrategy,
  type CanonicalJson,
  type LivefolioEnsureAdapter,
} from './livefolio';

// ---------------------------------------------------------------------------
// ensureStrategy
// ---------------------------------------------------------------------------

export async function ensureStrategy(
  client: TypedSupabaseClient,
  draft: StrategyDraft,
): Promise<{ strategy: Strategy; strategyId: number; created: boolean }> {
  const strategy = compileRules(draft);

  const adapter: LivefolioEnsureAdapter<CanonicalJson> = {
    async ensureStrategy(input) {
      const { data, error } = await (client as any).rpc('upsert_strategy', {
        p_strategy: {
          link_id: input.linkId,
          name: draft.name,
          definition: input.definition,
          definition_hash: input.definitionHash,
        },
      });

      if (error) throw new Error(`Failed to ensure strategy: ${error.message}`);

      const { data: stratRow, error: stratErr } = await client
        .from('strategies')
        .select('id')
        .eq('link_id', input.linkId)
        .single();

      if (stratErr || !stratRow) {
        throw new Error(`Strategy row not found after upsert for link_id: ${input.linkId}`);
      }

      return {
        strategyId: stratRow.id,
        linkId: input.linkId,
        created: true,
      };
    },
  };

  const result = await ensureLivefolioStrategy(
    draft as unknown as CanonicalJson,
    adapter,
  );

  return {
    strategy,
    strategyId: result.strategyId,
    created: result.created,
  };
}
