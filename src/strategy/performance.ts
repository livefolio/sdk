export interface PerformanceMetricPoint {
  timestampMs: number;
  value: number;
}

export interface PerformanceMetrics {
  cagr: number;
  maxDrawdown: number;
  volatility: number;
  sharpe: number;
  periodDays: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365.25;
const TRADING_DAYS = 252;

/**
 * Compute common backtest metrics from a time series.
 * Returns null when there are not enough valid points to compute.
 */
export function computePerformanceMetrics(
  input: PerformanceMetricPoint[],
): PerformanceMetrics | null {
  if (input.length < 2) return null;

  const points = input
    .filter((point) => Number.isFinite(point.timestampMs) && Number.isFinite(point.value))
    .sort((a, b) => a.timestampMs - b.timestampMs);

  if (points.length < 2) return null;

  const start = points[0]!.value;
  const end = points[points.length - 1]!.value;
  if (start <= 0 || end <= 0) return null;

  const years = Math.max(
    (points[points.length - 1]!.timestampMs - points[0]!.timestampMs) / (DAY_MS * YEAR_DAYS),
    1 / YEAR_DAYS,
  );
  const cagr = (Math.pow(end / start, 1 / years) - 1) * 100;

  let peak = points[0]!.value;
  let maxDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.value);
    const drawdown = ((point.value - peak) / peak) * 100;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  }

  const dailyReturns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!.value;
    const curr = points[i]!.value;
    if (prev > 0 && curr > 0) dailyReturns.push(curr / prev - 1);
  }

  let volatility = 0;
  let sharpe = 0;
  if (dailyReturns.length >= 2) {
    const mean = dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (dailyReturns.length - 1);
    const std = Math.sqrt(Math.max(variance, 0));
    volatility = std * Math.sqrt(TRADING_DAYS) * 100;
    sharpe = std > 0 ? (mean / std) * Math.sqrt(TRADING_DAYS) : 0;
  }

  return {
    cagr,
    maxDrawdown,
    volatility,
    sharpe,
    periodDays: Math.max(1, Math.round((points[points.length - 1]!.timestampMs - points[0]!.timestampMs) / DAY_MS)),
  };
}
