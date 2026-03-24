import type { TypedSupabaseClient } from '../types';
import type { AdminModule, UpsertEvaluationParams, UpsertObservationsParams } from './types';
import { signalKey } from '../strategy/evaluate';
import { fetchIndicatorKeyMap } from '../strategy/cache';

export function createAdmin(client: TypedSupabaseClient): AdminModule {
  const db = client as any;

  return {
    async upsertEvaluation(params: UpsertEvaluationParams): Promise<void> {
      const { strategy, result, tradingDayId } = params;

      const { data: stratRow } = await client
        .from('strategies')
        .select('id')
        .eq('link_id', strategy.linkId)
        .limit(1)
        .maybeSingle();

      const signalResults = Object.entries(result.signals).map(([_key, sigResult]) => {
        const ns = strategy.signals.find(
          (ns) => signalKey(ns.signal) === _key,
        );
        return { name: ns?.name ?? _key, result: sigResult };
      });

      const keyToId = stratRow ? await fetchIndicatorKeyMap(client, stratRow.id) : new Map<string, number>();
      const indicatorResults = Object.entries(result.indicators)
        .filter(([key]) => keyToId.has(key))
        .map(([key, indResult]) => ({
          indicatorId: keyToId.get(key)!,
          value: indResult.value,
          metadata: indResult.metadata ?? null,
        }));

      const { error } = await db.rpc('upsert_evaluation', {
        p_link_id: strategy.linkId,
        p_allocation_name: result.allocation.name,
        p_signal_results: signalResults,
        p_indicator_results: indicatorResults,
        p_trading_day_id: tradingDayId,
      });

      if (error) throw new Error(`Failed to store evaluation: ${error.message}`);
    },

    async upsertObservations(params: UpsertObservationsParams): Promise<void> {
      const { tickerId, observations } = params;

      const { error } = await db.rpc('upsert_observations', {
        p_ticker_id: tickerId,
        p_observations: observations,
      });

      if (error) throw new Error(`Failed to upsert observations: ${error.message}`);
    },
  };
}
