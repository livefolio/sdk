import type { Series } from '../../interfaces/types';

export type ReturnMode = 'pct' | 'abs';

export function returnSeries(series: Series, period: number, mode: ReturnMode = 'pct'): Series {
  if (period <= 0) throw new Error(`returnSeries: period must be positive, got ${period}`);
  if (series.length <= period) return [];
  const out: { t: Date; v: number }[] = [];
  for (let i = period; i < series.length; i++) {
    const curr = series[i]!.v;
    const prev = series[i - period]!.v;
    const v = mode === 'abs' ? curr - prev : (curr - prev) / prev;
    out.push({ t: series[i]!.t, v });
  }
  return out;
}
