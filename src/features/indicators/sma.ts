import type { Series } from '../../interfaces/types';

export function sma(series: Series, period: number): Series {
  if (period <= 0) throw new Error(`sma: period must be positive, got ${period}`);
  if (series.length < period) return [];
  const out: { t: Date; v: number }[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += series[i]!.v;
  out.push({ t: series[period - 1]!.t, v: sum / period });
  for (let i = period; i < series.length; i++) {
    sum += series[i]!.v - series[i - period]!.v;
    out.push({ t: series[i]!.t, v: sum / period });
  }
  return out;
}
