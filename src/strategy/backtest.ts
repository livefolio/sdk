import type { Strategy, BacktestOptions, BacktestResult } from './types';

export async function backtest(_strategy: Strategy, _options: BacktestOptions): Promise<BacktestResult> {
  throw new Error('Not implemented');
}
