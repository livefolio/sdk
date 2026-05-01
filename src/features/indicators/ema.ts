import type { Series } from '../../interfaces/types';

export function ema(series: Series, period: number): Series {
  if (period <= 0) throw new Error(`ema: period must be positive, got ${period}`);
  if (series.length < period) return [];
  const k = 2 / (period + 1);
  const out: { t: Date; v: number }[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += series[i]!.v;
  let prev = sum / period;
  out.push({ t: series[period - 1]!.t, v: prev });
  for (let i = period; i < series.length; i++) {
    prev = series[i]!.v * k + prev * (1 - k);
    out.push({ t: series[i]!.t, v: prev });
  }
  return out;
}
