import type { Observation } from '../market/types';
import type { StreamObservation } from './types';

export function mergeObservations(
  batchSeries: Record<string, Observation[]>,
  observations: StreamObservation[],
): Record<string, Observation[]> {
  let merged = { ...batchSeries };
  for (const obs of observations) {
    const series = [...(merged[obs.symbol] ?? [])];
    const obsDate = obs.timestamp.slice(0, 10); // YYYY-MM-DD
    const idx = series.findIndex(o => o.timestamp.slice(0, 10) === obsDate);
    const entry: Observation = { timestamp: obs.timestamp, value: obs.value };
    if (idx >= 0) series[idx] = entry; // replace incomplete bar
    else series.push(entry);           // append new day
    merged = { ...merged, [obs.symbol]: series };
  }
  return merged;
}
