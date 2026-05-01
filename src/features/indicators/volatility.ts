import type { Series } from '../../interfaces/types';

export function volatility(series: Series, period: number): Series {
  if (period <= 0) throw new Error(`volatility: period must be positive, got ${period}`);
  if (series.length < period + 1) return [];
  const dailyReturns: { t: Date; v: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    dailyReturns.push({
      t: series[i]!.t,
      v: series[i]!.v / series[i - 1]!.v - 1,
    });
  }
  if (dailyReturns.length < period) return [];
  const out: { t: Date; v: number }[] = [];
  for (let i = period - 1; i < dailyReturns.length; i++) {
    const window = dailyReturns.slice(i - period + 1, i + 1);
    const mean = window.reduce((s, r) => s + r.v, 0) / period;
    const variance = window.reduce((s, r) => s + (r.v - mean) ** 2, 0) / period;
    out.push({ t: dailyReturns[i]!.t, v: Math.sqrt(variance) });
  }
  return out;
}
