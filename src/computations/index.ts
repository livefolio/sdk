import type { DailyBar } from '../handles/indicator.js';
import type { Database } from '../database.types.js';
import { computeSma } from './sma.js';
import { computeEma } from './ema.js';
import { computeRsi } from './rsi.js';
import { computeReturns } from './returns.js';
import { computeVolatility } from './volatility.js';
import { computeDrawdown } from './drawdown.js';

export { computeSma } from './sma.js';
export { computeEma } from './ema.js';
export { computeRsi } from './rsi.js';
export { computeReturns } from './returns.js';
export { computeVolatility } from './volatility.js';
export { computeDrawdown } from './drawdown.js';
export { computeCalendar } from './calendar.js';

type IndicatorType = Database['public']['Enums']['indicator_type'];
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
