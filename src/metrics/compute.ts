import type { DailyBar } from '../handles/indicator';
import type { Trade } from '../backtest/types';
import type { MetricsOptions, MetricsResult } from './types';

export function computeMetrics(series: DailyBar[], _trades: Trade[], _options: MetricsOptions = {}): MetricsResult {
  if (series.length < 2) {
    throw new Error('metrics requires at least 2 daily bars');
  }
  throw new Error('not implemented');
}
