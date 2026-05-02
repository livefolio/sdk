import type { DailyBar } from '../handles/indicator';

const TRADING_DAYS = 252;

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return Math.sqrt(s / (xs.length - 1));
}

export function volatility(returns: number[]): number {
  return stdev(returns) * Math.sqrt(TRADING_DAYS);
}

export function downsideDeviation(returns: number[], marDaily: number): number {
  if (returns.length === 0) return 0;
  let s = 0;
  for (const r of returns) {
    const d = Math.min(0, r - marDaily);
    s += d * d;
  }
  return Math.sqrt(s / returns.length) * Math.sqrt(TRADING_DAYS);
}

export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return 0;
  let sum = 0;
  for (const x of xs) {
    const z = (x - m) / s;
    sum += z * z * z;
  }
  return (n / ((n - 1) * (n - 2))) * sum;
}

export function excessKurtosis(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return 0;
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return 0;
  let sum = 0;
  for (const x of xs) {
    const z = (x - m) / s;
    sum += z * z * z * z;
  }
  const term1 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const term2 = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  return term1 * sum - term2;
}

function quantile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

export function historicalVar(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const q = quantile(sorted, 1 - confidence);
  return Math.max(0, -q);
}

export function historicalCvar(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const q = quantile(sorted, 1 - confidence);
  const tail = sorted.filter((r) => r <= q);
  if (tail.length === 0) return 0;
  return Math.max(0, -mean(tail));
}

export function ulcerIndex(series: DailyBar[]): number {
  if (series.length === 0) return 0;
  let runningMax = -Infinity;
  let sumSq = 0;
  for (const bar of series) {
    if (bar.value > runningMax) runningMax = bar.value;
    const ddPct = ((bar.value - runningMax) / runningMax) * 100;
    sumSq += ddPct * ddPct;
  }
  return Math.sqrt(sumSq / series.length);
}
