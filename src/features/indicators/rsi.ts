import type { Series } from '../../interfaces/types';

export function rsi(series: Series, period: number): Series {
  if (period <= 0) throw new Error(`rsi: period must be positive, got ${period}`);
  if (series.length < period + 1) return [];
  const changes: number[] = [];
  for (let i = 1; i < series.length; i++) {
    changes.push(series[i]!.v - series[i - 1]!.v);
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i]! > 0) avgGain += changes[i]!;
    else avgLoss += Math.abs(changes[i]!);
  }
  avgGain /= period;
  avgLoss /= period;
  const out: { t: Date; v: number }[] = [];
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  out.push({
    t: series[period]!.t,
    v: avgLoss === 0 ? 100 : 100 - 100 / (1 + rs),
  });
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i]! > 0 ? changes[i]! : 0;
    const loss = changes[i]! < 0 ? Math.abs(changes[i]!) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const smoothRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out.push({
      t: series[i + 1]!.t,
      v: avgLoss === 0 ? 100 : 100 - 100 / (1 + smoothRs),
    });
  }
  return out;
}
