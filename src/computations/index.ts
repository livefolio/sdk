import type { DailyBar } from '../handles/indicator';
import type { IndicatorType } from '../providers/types';
import { computeSma } from './sma';
import { computeEma } from './ema';
import { computeRsi } from './rsi';
import { computeReturns } from './returns';
import { computeVolatility } from './volatility';
import { computeDrawdown } from './drawdown';
import { smaNext, smaInitialState } from './sma';
import { emaNext, emaInitialState } from './ema';
import { rsiNext, rsiInitialState } from './rsi';
import { returnNext, returnInitialState } from './returns';
import { volatilityNext, volatilityInitialState } from './volatility';
import { drawdownNext, drawdownInitialState } from './drawdown';

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

export type NextStepFn = (prev: unknown, newRaw: number, lookback: number) => { value: number; state: unknown };

export type InitialStateFn = (bars: DailyBar[], lookback: number) => unknown | null;

const NEXT: Record<string, NextStepFn> = {
  SMA: smaNext as NextStepFn,
  EMA: emaNext as NextStepFn,
  RSI: rsiNext as NextStepFn,
  Return: ((prev, newRaw, lookback) => returnNext(prev as { tail: number[] }, newRaw, lookback, 'pct')) as NextStepFn,
  Volatility: volatilityNext as NextStepFn,
  Drawdown: drawdownNext as NextStepFn,
};

const SEED: Record<string, InitialStateFn> = {
  SMA: smaInitialState as InitialStateFn,
  EMA: emaInitialState as InitialStateFn,
  RSI: rsiInitialState as InitialStateFn,
  Return: returnInitialState as InitialStateFn,
  Volatility: volatilityInitialState as InitialStateFn,
  Drawdown: drawdownInitialState as InitialStateFn,
};

export function getNextComputation(type: string): NextStepFn | undefined {
  return NEXT[type];
}

export function getInitialStateFn(type: string): InitialStateFn | undefined {
  return SEED[type];
}
