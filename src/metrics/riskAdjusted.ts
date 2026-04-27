import { mean, stdev, downsideDeviation } from './risk';

const TRADING_DAYS = 252;

export function dailyRiskFree(annual: number): number {
  return Math.pow(1 + annual, 1 / TRADING_DAYS) - 1;
}

export function sharpe(returns: number[], rfAnnual: number): number {
  const rfDaily = dailyRiskFree(rfAnnual);
  const s = stdev(returns);
  if (s === 0) return NaN;
  return ((mean(returns) - rfDaily) / s) * Math.sqrt(TRADING_DAYS);
}

export function sortino(returns: number[], rfAnnual: number): number {
  const rfDaily = dailyRiskFree(rfAnnual);
  const dd = downsideDeviation(returns, rfDaily);
  if (dd === 0) return NaN;
  return ((mean(returns) - rfDaily) * TRADING_DAYS) / dd;
}

export function calmar(cagrValue: number, maxDdDepth: number): number {
  if (maxDdDepth === 0) return Infinity;
  return cagrValue / Math.abs(maxDdDepth);
}
