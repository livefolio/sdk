import type { TypedSupabaseClient } from '../types';
import type { MarketModule, Observation } from '../market/types';
import type { Strategy, StrategyEvaluation, StreamObservation } from './types';
import { evaluate as evaluatePure } from './evaluate';
import { extractSymbols as extractSymbolsPure } from './symbols';
import { fetchSignalStates, fetchIndicatorMetadata } from './cache';

function mergeObservation(
  batchSeries: Record<string, Observation[]>,
  obs: StreamObservation,
): Record<string, Observation[]> {
  const series = [...(batchSeries[obs.symbol] ?? [])];
  const obsDate = obs.timestamp.slice(0, 10); // YYYY-MM-DD
  const idx = series.findIndex(o => o.timestamp.slice(0, 10) === obsDate);
  const entry: Observation = { timestamp: obs.timestamp, value: obs.value };
  if (idx >= 0) series[idx] = entry; // replace incomplete bar
  else series.push(entry);           // append new day
  return { ...batchSeries, [obs.symbol]: series };
}

export async function stream(
  client: TypedSupabaseClient,
  market: MarketModule,
  strategy: Strategy,
  observation: StreamObservation,
): Promise<StrategyEvaluation> {
  // 1. Fetch historical series for all symbols
  const symbols = extractSymbolsPure(strategy);
  const batchSeries = await market.getBatchSeries(symbols);

  // 2. Merge the incoming observation into the series (replace same-date or append)
  const mergedSeries = mergeObservation(batchSeries, observation);

  // 3. Build evaluation options with observation timestamp
  const at = new Date(observation.timestamp);
  const options = { at, batchSeries: mergedSeries };

  // 4. Fetch prior signal states for hysteresis (read-only, no cache write)
  const stratRow = await client
    .from('strategies')
    .select('id')
    .eq('link_id', strategy.linkId)
    .limit(1)
    .maybeSingle()
    .then(({ data }) => data);

  let prevSignals: Record<string, boolean> = {};
  let prevMeta: Record<string, unknown> = {};
  if (stratRow) {
    [prevSignals, prevMeta] = await Promise.all([
      fetchSignalStates(client, stratRow.id),
      fetchIndicatorMetadata(client, stratRow.id),
    ]);
  }

  // 5. Evaluate (skip cache check and result storage — interim data)
  return evaluatePure(strategy, {
    ...options,
    previousSignalStates: prevSignals,
    previousIndicatorMetadata: prevMeta,
  });
}
