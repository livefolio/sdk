import type { DailyBar } from '../handles/indicator';
import type { IndicatorType } from '../providers/types';
import { computeSma } from './sma';
import { computeEma } from './ema';
import { computeRsi } from './rsi';
import { computeReturns } from './returns';
import { computeVolatility } from './volatility';
import { computeDrawdown } from './drawdown';

export { computeSma } from './sma';
export { computeEma } from './ema';
export { computeRsi } from './rsi';
export { computeReturns } from './returns';
export { computeVolatility } from './volatility';
export { computeDrawdown } from './drawdown';
export { computeCalendar } from './calendar';
type ComputeFn = (bars: DailyBar[], lookback: number) => DailyBar[];

const COMPUTATIONS: Partial<Record<IndicatorType, ComputeFn>> = {
  SMA: computeSma,
  EMA: computeEma,
  RSI: computeRsi,
  Return: computeReturns,
  Volatility: computeVolatility,
  Drawdown: computeDrawdown,
};

export function getComputation(type: IndicatorType): ComputeFn | null {
  return COMPUTATIONS[type] ?? null;
}
