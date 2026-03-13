import type { TypedSupabaseClient } from '../types';
import type { MarketModule } from '../market/types';
import type {
  Strategy,
  SubscriptionForEvaluation,
  EvaluationBatchResult,
  EvaluationResultEntry,
  EvaluationErrorEntry,
} from './types';
import { evaluate as evaluatePure, signalKey } from './evaluate';
import { extractSymbols } from './symbols';
import { fetchSignalStates, fetchIndicatorMetadata } from './cache';

// ---------------------------------------------------------------------------
// evaluateSubscriptions
// ---------------------------------------------------------------------------

export async function evaluateSubscriptions(
  client: TypedSupabaseClient,
  market: MarketModule,
  options: {
    at: Date;
    isEarly: boolean;
    subscriptions: SubscriptionForEvaluation[];
    strategies: Record<string, Strategy>;
  },
): Promise<EvaluationBatchResult> {
  const { at, subscriptions, strategies } = options;

  // 1. Group subscriptions by strategyLinkId
  const subsByLinkId = new Map<string, SubscriptionForEvaluation[]>();
  for (const sub of subscriptions) {
    const list = subsByLinkId.get(sub.strategyLinkId) ?? [];
    list.push(sub);
    subsByLinkId.set(sub.strategyLinkId, list);
  }

  // 2. Collect all symbols across all strategies
  const allSymbols = new Set<string>();
  for (const linkId of subsByLinkId.keys()) {
    const strategy = strategies[linkId];
    if (strategy) {
      for (const symbol of extractSymbols(strategy)) {
        allSymbols.add(symbol);
      }
    }
  }

  // 3. Fetch all series in one batch
  const batchSeries = await market.getBatchSeries([...allSymbols]);

  // 4. Evaluate each strategy in parallel with error isolation
  const linkIds = [...subsByLinkId.keys()];
  const settled = await Promise.allSettled(
    linkIds.map(async (linkId): Promise<EvaluationResultEntry> => {
      const strategy = strategies[linkId];
      if (!strategy) throw new Error(`Strategy not found for link_id: ${linkId}`);

      const subs = subsByLinkId.get(linkId)!;

      // 4a. Look up strategy_id from DB
      const { data: stratRow, error: stratErr } = await client
        .from('strategies')
        .select('id')
        .eq('link_id', linkId)
        .single();

      if (stratErr || !stratRow) {
        throw new Error(`Strategy row not found for link_id: ${linkId}`);
      }

      const strategyId = stratRow.id;

      // 4b–4c. Fetch previous signal states + indicator metadata
      const [previousSignalStates, previousIndicatorMetadata] = await Promise.all([
        fetchSignalStates(client, strategyId),
        fetchIndicatorMetadata(client, strategyId),
      ]);

      // 4d. Fetch previous evaluation (allocation name)
      const db = client as any;
      const { data: prevEvalRow } = await db
        .from('evaluations')
        .select('allocation_id, allocations(name)')
        .eq('strategy_id', strategyId)
        .order('trading_day_id', { ascending: false })
        .limit(1)
        .maybeSingle();

      const previousAllocationName: string | null =
        prevEvalRow?.allocations?.name ?? null;

      // 4e. Run pure evaluation
      const evaluation = evaluatePure(strategy, {
        at,
        batchSeries,
        previousSignalStates,
        previousIndicatorMetadata,
      });

      // 4f. Determine if allocation changed
      const changed = previousAllocationName !== evaluation.allocation.name;

      // 4g. Store via upsert_evaluation RPC
      // Resolve trading_day_id
      const { data: tdRow } = await db
        .from('trading_days')
        .select('id')
        .lte('post', evaluation.asOf.toISOString())
        .order('post', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (tdRow) {
        const signalResults = Object.entries(evaluation.signals).map(([key, sigResult]) => {
          const ns = strategy.signals.find((ns) => signalKey(ns.signal) === key);
          return { name: ns?.name ?? key, result: sigResult };
        });

        const { error: rpcErr } = await db.rpc('upsert_evaluation', {
          p_link_id: strategy.linkId,
          p_allocation_name: evaluation.allocation.name,
          p_signal_results: signalResults,
          p_indicator_results: [],
          p_trading_day_id: tdRow.id,
        });

        if (rpcErr) {
          throw new Error(`Failed to store evaluation for ${linkId}: ${rpcErr.message}`);
        }
      }

      return {
        strategyLinkId: linkId,
        evaluation,
        strategy,
        previousAllocationName,
        changed,
        subscribers: subs,
      };
    }),
  );

  // 5. Collect results and errors
  const evaluations: EvaluationResultEntry[] = [];
  const errors: EvaluationErrorEntry[] = [];

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') {
      evaluations.push(outcome.value);
    } else {
      errors.push({
        strategyLinkId: linkIds[i],
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    }
  }

  return { evaluations, errors };
}
