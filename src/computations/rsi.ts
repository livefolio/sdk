import type { DailyBar } from '../handles/indicator.js';

export function computeRsi(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback + 1) return [];
  const changes: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    changes.push(bars[i].value - bars[i - 1].value);
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < lookback; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= lookback;
  avgLoss /= lookback;
  const result: DailyBar[] = [];
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({
    date: bars[lookback].date,
    value: avgLoss === 0 ? 100 : 100 - 100 / (1 + rs),
  });
  for (let i = lookback; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (lookback - 1) + gain) / lookback;
    avgLoss = (avgLoss * (lookback - 1) + loss) / lookback;
    const smoothRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({
      date: bars[i + 1].date,
      value: avgLoss === 0 ? 100 : 100 - 100 / (1 + smoothRs),
    });
  }
  return result;
}
