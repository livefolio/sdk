import type { Series } from '../../interfaces/types';

export function drawdown(series: Series, period: number): Series {
  if (period <= 0) throw new Error(`drawdown: period must be positive, got ${period}`);
  if (series.length < period) return [];
  const out: { t: Date; v: number }[] = [];
  for (let i = period - 1; i < series.length; i++) {
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (series[j]!.v > max) max = series[j]!.v;
    }
    out.push({ t: series[i]!.t, v: (series[i]!.v - max) / max });
  }
  return out;
}
