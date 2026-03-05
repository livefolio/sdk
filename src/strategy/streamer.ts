import type { TypedSupabaseClient } from '../types';
import type { MarketModule } from '../market/types';
import type { Streamer, Strategy, StrategyEvaluation, StreamObservation } from './types';
import type { Observation } from '../market/types';
import { evaluate as evaluatePure } from './evaluate';
import { extractSymbols as extractSymbolsPure } from './symbols';
import { fetchSignalStates, fetchIndicatorMetadata } from './cache';
import { mergeObservations } from './stream';

export async function createStreamer(
  client: TypedSupabaseClient,
  market: MarketModule,
  strategy: Strategy,
): Promise<Streamer> {
  // 1. Fetch historical series
  const symbols = extractSymbolsPure(strategy);
  const initialSeries = await market.getBatchSeries(symbols);

  // 2. Fetch prior state from DB
  const stratRow = await client
    .from('strategies')
    .select('id')
    .eq('link_id', strategy.linkId)
    .limit(1)
    .maybeSingle()
    .then(({ data }) => data);

  let previousSignalStates: Record<string, boolean> = {};
  let previousIndicatorMetadata: Record<string, unknown> = {};
  if (stratRow) {
    [previousSignalStates, previousIndicatorMetadata] = await Promise.all([
      fetchSignalStates(client, stratRow.id),
      fetchIndicatorMetadata(client, stratRow.id),
    ]);
  }

  // 3. Mutable closure state
  let batchSeries: Record<string, Observation[]> = initialSeries;

  return {
    update(observation: StreamObservation | StreamObservation[]): StrategyEvaluation {
      const observations = Array.isArray(observation) ? observation : [observation];
      if (observations.length === 0) {
        throw new Error('update() requires at least one observation');
      }

      // Merge observations into held series
      batchSeries = mergeObservations(batchSeries, observations);

      // Evaluate
      const at = new Date(observations[observations.length - 1].timestamp);
      const result = evaluatePure(strategy, {
        at,
        batchSeries,
        previousSignalStates,
        previousIndicatorMetadata,
      });

      // Carry forward state
      previousSignalStates = { ...result.signals };
      previousIndicatorMetadata = {};
      for (const [key, ind] of Object.entries(result.indicators)) {
        if (ind.metadata != null) {
          previousIndicatorMetadata[key] = ind.metadata;
        }
      }

      return result;
    },
  };
}
