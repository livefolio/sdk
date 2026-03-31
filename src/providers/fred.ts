import type { DailyBar } from '../handles/indicator.js';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations: FredObservation[];
}

export async function fetchFred(seriesId: string, apiKey: string, from?: string): Promise<DailyBar[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
  });

  if (from) params.set('observation_start', from);

  const res = await fetch(`${FRED_BASE}?${params}`);
  if (!res.ok) throw new Error(`FRED API error: ${res.status} ${res.statusText}`);

  const json: FredResponse = await res.json();

  return json.observations
    .filter((o) => o.value !== '.')
    .map((o) => ({
      date: o.date,
      value: parseFloat(o.value),
    }));
}
