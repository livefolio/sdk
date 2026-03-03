import type { Observation } from '../market/types';
import type {
  Allocation,
  Condition,
  EvaluationOptions,
  Indicator,
  IndicatorEvaluation,
  IndicatorType,
  Signal,
  Strategy,
  StrategyEvaluation,
  Ticker,
  Trading,
} from './types';
import { INDICATOR_SYMBOL_MAP } from './symbols';
import { isAtMarketClose } from './time';

// ---------------------------------------------------------------------------
// Internal observation format (Date timestamps, price field)
// ---------------------------------------------------------------------------

interface InternalObs {
  timestamp: Date;
  price: number;
}

function toInternalSeries(series: Observation[]): InternalObs[] {
  return series.map((o) => ({ timestamp: new Date(o.timestamp), price: o.value }));
}

// ---------------------------------------------------------------------------
// Indicator key (used for diagnostics + metadata lookup)
// ---------------------------------------------------------------------------

export function indicatorKey(ind: Indicator): string {
  if (ind.type === 'Threshold') return `Threshold_${ind.threshold ?? 0}`;
  const d = ind.delay ? `_d${ind.delay}` : '';
  return `${ind.type}_${ind.ticker.symbol}_${ind.lookback}${d}`;
}

// ---------------------------------------------------------------------------
// Signal identity key (for previousSignalStates lookup)
// ---------------------------------------------------------------------------

export function signalKey(signal: Signal): string {
  return `${indicatorKey(signal.left)}_${signal.comparison}_${indicatorKey(signal.right)}_t${signal.tolerance}`;
}

// ---------------------------------------------------------------------------
// Series picking
// ---------------------------------------------------------------------------

function pickSeries(
  batchSeries: Record<string, Observation[]>,
  ticker: Ticker,
  at: Date,
  lookback: number,
  delay: number,
): InternalObs[] {
  const source = toInternalSeries(batchSeries[ticker.symbol] ?? []);

  let atIndex = source.length - 1;
  for (let i = source.length - 1; i >= 0; i--) {
    if (source[i].timestamp <= at) {
      atIndex = i;
      break;
    }
  }

  const end = atIndex + 1 - delay;
  const start = Math.max(0, end - lookback);
  const obs = source.slice(start, end);

  if (ticker.leverage === 1 || obs.length === 0) {
    return obs;
  }

  const leveraged: InternalObs[] = [obs[0]];
  for (let i = 1; i < obs.length; i++) {
    const dailyReturn = (obs[i].price - obs[i - 1].price) / obs[i - 1].price;
    const leveragedReturn = dailyReturn * ticker.leverage;
    const leveragedPrice = leveraged[i - 1].price * (1 + leveragedReturn);
    leveraged.push({ timestamp: obs[i].timestamp, price: leveragedPrice });
  }

  return leveraged;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function smooth(values: number[], k: number): number {
  let avg = values[0];
  for (let i = 1; i < values.length; i++) {
    avg = values[i] * k + avg * (1 - k);
  }
  return avg;
}

function percentChange(a: number, b: number): number {
  return ((b - a) / a) * 100;
}

// ---------------------------------------------------------------------------
// Indicator functions
// ---------------------------------------------------------------------------

type IndicatorFn = (
  batchSeries: Record<string, Observation[]>,
  ticker: Ticker,
  at: Date,
  lookback: number,
  delay: number,
  metadata?: unknown,
) => IndicatorEvaluation;

function makeResult(timestamp: Date, value: number, metadata?: unknown): IndicatorEvaluation {
  return { timestamp: timestamp.toISOString(), value, ...(metadata !== undefined ? { metadata } : {}) };
}

const INDICATOR_FNS: Record<IndicatorType, IndicatorFn> = {
  SMA(batchSeries, ticker, at, lookback, delay) {
    const obs = pickSeries(batchSeries, ticker, at, lookback, delay);
    if (obs.length === 0) {
      throw new Error(`SMA: No observations found for ${ticker.symbol} at ${at.toISOString()}.`);
    }
    const prices = obs.map((o) => o.price);
    return makeResult(obs[obs.length - 1].timestamp, mean(prices));
  },

  EMA(batchSeries, ticker, at, lookback, delay, prevMeta) {
    const k = 2 / (lookback + 1);

    // Incremental path: if we have previous EMA value, compute O(1)
    if (prevMeta && typeof prevMeta === 'object' && 'ema' in prevMeta) {
      const prevEma = (prevMeta as { ema: number }).ema;
      const obs = pickSeries(batchSeries, ticker, at, 1, delay);
      if (obs.length > 0) {
        const price = obs[obs.length - 1].price;
        const newEma = price * k + prevEma * (1 - k);
        return makeResult(obs[obs.length - 1].timestamp, newEma, { ema: newEma });
      }
    }

    // Full series fallback
    const obs = pickSeries(batchSeries, ticker, at, Infinity, delay);
    if (obs.length === 0) {
      throw new Error(`EMA: No observations found for ${ticker.symbol} at ${at.toISOString()}.`);
    }
    const prices = obs.map((o) => o.price);
    const ema = smooth(prices, k);
    return makeResult(obs[obs.length - 1].timestamp, ema, { ema });
  },

  Price(batchSeries, ticker, at, _lookback, delay) {
    const obs = pickSeries(batchSeries, ticker, at, 1, delay);
    if (obs.length === 0) {
      throw new Error(`Price: No observations found for ${ticker.symbol} at ${at.toISOString()}.`);
    }
    return makeResult(obs[obs.length - 1].timestamp, obs[obs.length - 1].price);
  },

  Return(batchSeries, ticker, at, lookback, delay) {
    const obs = pickSeries(batchSeries, ticker, at, lookback, delay);
    if (obs.length === 0) {
      throw new Error(`Return: No observations found for ${ticker.symbol} at ${at.toISOString()}.`);
    }
    return makeResult(obs[obs.length - 1].timestamp, percentChange(obs[0].price, obs[obs.length - 1].price));
  },

  Volatility(batchSeries, ticker, at, lookback, delay) {
    const obs = pickSeries(batchSeries, ticker, at, lookback, delay);
    if (obs.length === 0) {
      throw new Error(`Volatility: No observations found for ${ticker.symbol} at ${at.toISOString()}.`);
    }
    const prices = obs.map((o) => o.price);
    const returns = prices.slice(1).map((price, i) => (price - prices[i]) / prices[i]);
    const meanReturn = mean(returns);
    const variance = mean(returns.map((r) => Math.pow(r - meanReturn, 2)));
    const sd = Math.sqrt(variance);
    const annualized = sd * Math.sqrt(252) * 100;
    return makeResult(obs[obs.length - 1].timestamp, annualized);
  },

  Drawdown(batchSeries, ticker, at, _lookback, delay, prevMeta) {
    // Incremental peak tracking
    if (prevMeta && typeof prevMeta === 'object' && 'peak' in prevMeta) {
      const prevPeak = (prevMeta as { peak: number }).peak;
      const obs = pickSeries(batchSeries, ticker, at, 1, delay);
      if (obs.length > 0) {
        const current = obs[obs.length - 1].price;
        const peak = Math.max(prevPeak, current);
        const dd = Math.abs(percentChange(peak, current));
        return makeResult(obs[obs.length - 1].timestamp, dd, { peak });
      }
    }

    // Full series fallback
    const obs = pickSeries(batchSeries, ticker, at, Infinity, delay);
    if (obs.length === 0) {
      throw new Error(`Drawdown: No observations found for ${ticker.symbol} at ${at.toISOString()}.`);
    }
    const prices = obs.map((o) => o.price);
    const current = prices[prices.length - 1];
    const peak = Math.max(...prices);
    const dd = Math.abs(percentChange(peak, current));
    return makeResult(obs[obs.length - 1].timestamp, dd, { peak });
  },

  RSI(batchSeries, ticker, at, lookback, delay, prevMeta) {
    const k = 1 / lookback;

    // Incremental path
    if (prevMeta && typeof prevMeta === 'object' && 'avgGain' in prevMeta && 'avgLoss' in prevMeta) {
      const { avgGain: prevAvgGain, avgLoss: prevAvgLoss } = prevMeta as {
        avgGain: number;
        avgLoss: number;
      };
      const obs = pickSeries(batchSeries, ticker, at, 2, delay);
      if (obs.length >= 2) {
        const change = obs[obs.length - 1].price - obs[obs.length - 2].price;
        const gain = change >= 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        const avgGain = gain * k + prevAvgGain * (1 - k);
        const avgLoss = loss * k + prevAvgLoss * (1 - k);
        const rsi = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
        return makeResult(obs[obs.length - 1].timestamp, rsi, { avgGain, avgLoss });
      }
    }

    // Full series fallback
    const obs = pickSeries(batchSeries, ticker, at, Infinity, delay);
    if (obs.length === 0) {
      throw new Error(`RSI: No observations found for ${ticker.symbol} at ${at.toISOString()}.`);
    }
    const prices = obs.map((o) => o.price);
    const returns = prices.slice(1).map((price, i) => price - prices[i]);
    const gains = returns.map((delta) => (delta >= 0 ? delta : 0));
    const losses = returns.map((delta) => (delta < 0 ? -delta : 0));
    const avgGain = smooth(gains, k);
    const avgLoss = smooth(losses, k);
    const rsi = avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
    return makeResult(obs[obs.length - 1].timestamp, rsi, { avgGain, avgLoss });
  },

  VIX(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['VIX']!, leverage: 1 }, at, lookback, delay);
  },
  VIX3M(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['VIX3M']!, leverage: 1 }, at, lookback, delay);
  },
  T3M(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['T3M']!, leverage: 1 }, at, lookback, delay);
  },
  T6M(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['T6M']!, leverage: 1 }, at, lookback, delay);
  },
  T1Y(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['T1Y']!, leverage: 1 }, at, lookback, delay);
  },
  T2Y(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['T2Y']!, leverage: 1 }, at, lookback, delay);
  },
  T3Y(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['T3Y']!, leverage: 1 }, at, lookback, delay);
  },
  T5Y(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['T5Y']!, leverage: 1 }, at, lookback, delay);
  },
  T7Y(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['T7Y']!, leverage: 1 }, at, lookback, delay);
  },
  T10Y(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['T10Y']!, leverage: 1 }, at, lookback, delay);
  },
  T20Y(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['T20Y']!, leverage: 1 }, at, lookback, delay);
  },
  T30Y(batchSeries, _ticker, at, lookback, delay) {
    return INDICATOR_FNS.Price(batchSeries, { symbol: INDICATOR_SYMBOL_MAP['T30Y']!, leverage: 1 }, at, lookback, delay);
  },

  Month(_batchSeries, _ticker, at, _lookback, delay) {
    const date = new Date(at.getTime() - delay * 24 * 60 * 60 * 1000);
    return makeResult(date, date.getUTCMonth() + 1);
  },
  'Day of Week'(_batchSeries, _ticker, at, _lookback, delay) {
    const date = new Date(at.getTime() - delay * 24 * 60 * 60 * 1000);
    return makeResult(date, date.getUTCDay());
  },
  'Day of Month'(_batchSeries, _ticker, at, _lookback, delay) {
    const date = new Date(at.getTime() - delay * 24 * 60 * 60 * 1000);
    return makeResult(date, date.getUTCDate());
  },
  'Day of Year'(_batchSeries, _ticker, at, _lookback, delay) {
    const date = new Date(at.getTime() - delay * 24 * 60 * 60 * 1000);
    const utcDate = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const utcYearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
    const dayOfYear = (utcDate - utcYearStart) / (24 * 60 * 60 * 1000);
    return makeResult(date, dayOfYear);
  },

  Threshold() {
    throw new Error('Threshold should not be evaluated as an indicator function.');
  },
};

// ---------------------------------------------------------------------------
// Public evaluation functions
// ---------------------------------------------------------------------------

export function evaluateIndicator(
  indicator: Indicator,
  options: EvaluationOptions,
): IndicatorEvaluation {
  if (indicator.type === 'Threshold') {
    return makeResult(options.at, indicator.threshold!);
  }

  const delay = indicator.delay;

  // Temporal indicators don't depend on series
  if (['Month', 'Day of Week', 'Day of Month', 'Day of Year'].includes(indicator.type)) {
    return INDICATOR_FNS[indicator.type](
      options.batchSeries, indicator.ticker, options.at, indicator.lookback, delay,
    );
  }

  // Get previous metadata for incremental evaluation
  const key = indicatorKey(indicator);
  const prevMeta = options.previousIndicatorMetadata?.[key];

  return INDICATOR_FNS[indicator.type](
    options.batchSeries, indicator.ticker, options.at, indicator.lookback, delay, prevMeta,
  );
}

export function evaluateSignal(signal: Signal, options: EvaluationOptions): boolean {
  const left = evaluateIndicator(signal.left, options);
  const right = evaluateIndicator(signal.right, options);
  const tolerance = signal.tolerance ?? 0;
  const rawToleranceDelta =
    signal.left.unit === '%' ? tolerance : Math.abs(right.value) * (tolerance / 100);
  const toleranceDelta = Number.isFinite(rawToleranceDelta) ? Math.abs(rawToleranceDelta) : 0;
  const lowerBound = Math.min(right.value - toleranceDelta, right.value + toleranceDelta);
  const upperBound = Math.max(right.value - toleranceDelta, right.value + toleranceDelta);
  const comparison = signal.comparison;

  if (comparison === '=') {
    return lowerBound <= left.value && left.value <= upperBound;
  }

  // Cold start: if no prior state exists for this signal, evaluate strict comparator.
  const key = signalKey(signal);
  const previous = options.previousSignalStates?.[key];
  const hasPrevious = previous !== undefined;

  // Zero tolerance means no dead band; preserve strict legacy behavior.
  if (!hasPrevious || toleranceDelta === 0) {
    return comparison === '>' ? left.value > right.value : left.value < right.value;
  }

  if (comparison === '>') {
    return previous
      ? left.value >= lowerBound // stay true inside band; turn off only fully below
      : left.value > upperBound; // turn on only after fully crossing above
  } else {
    return previous
      ? left.value <= upperBound // stay true inside band; turn off only fully above
      : left.value < lowerBound; // turn on only after fully crossing below
  }
}

export function evaluateAllocation(allocation: Allocation, options: EvaluationOptions): boolean {
  return evaluateCondition(allocation.condition, options);
}

function evaluateCondition(condition: Condition, options: EvaluationOptions): boolean {
  switch (condition.kind) {
    case 'or':
      return condition.args.some((andExpr) => evaluateCondition(andExpr, options));
    case 'and':
      return condition.args.every((unaryExpr) => evaluateCondition(unaryExpr, options));
    case 'not':
      return !evaluateSignal(condition.signal, options);
    case 'signal':
      return evaluateSignal(condition.signal, options);
  }
}

export function evaluate(strategy: Strategy, options: EvaluationOptions): StrategyEvaluation {
  // Collect all unique signals from all allocations
  const allSignals = getAllSignalsFromStrategy(strategy);
  const indicatorsMap = new Map<string, IndicatorEvaluation>();
  const indicatorsOrder: string[] = [];

  for (const signal of allSignals) {
    for (const ind of [signal.left, signal.right]) {
      const key = indicatorKey(ind);
      if (indicatorsMap.has(key)) continue;
      const res = evaluateIndicator(ind, options);
      indicatorsMap.set(key, res);
      indicatorsOrder.push(key);
    }
  }

  const indicators: Record<string, IndicatorEvaluation> = {};
  for (const k of indicatorsOrder) indicators[k] = indicatorsMap.get(k)!;

  const signals: Record<string, boolean> = {};
  for (const signal of allSignals) {
    signals[signalKey(signal)] = evaluateSignal(signal, options);
  }

  // Find first matching allocation
  const sorted = [...strategy.allocations].sort((a, b) => a.position - b.position);

  let winning = sorted[sorted.length - 1];
  for (const na of sorted) {
    if (evaluateAllocation(na.allocation, options)) {
      winning = na;
      break;
    }
  }

  const asOf = getEvaluationDate(strategy.trading, options);

  return {
    allocation: {
      name: winning.name,
      holdings: winning.allocation.holdings,
    },
    asOf,
    signals,
    indicators,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAllSignalsFromStrategy(strategy: Strategy): Signal[] {
  const seen = new Set<string>();
  const out: Signal[] = [];

  for (const na of strategy.allocations) {
    for (const s of findAllSignals(na.allocation.condition)) {
      const key = signalKey(s);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(s);
      }
    }
  }

  return out;
}

export function findAllSignals(condition: Condition): Signal[] {
  const signals: Signal[] = [];
  const seen = new Set<string>();

  function traverse(cond: Condition): void {
    switch (cond.kind) {
      case 'or':
        cond.args.forEach(traverse);
        break;
      case 'and':
        cond.args.forEach(traverse);
        break;
      case 'not': {
        const key = signalKey(cond.signal);
        if (!seen.has(key)) {
          seen.add(key);
          signals.push(cond.signal);
        }
        break;
      }
      case 'signal': {
        const key = signalKey(cond.signal);
        if (!seen.has(key)) {
          seen.add(key);
          signals.push(cond.signal);
        }
        break;
      }
    }
  }

  traverse(condition);
  return signals;
}

// ---------------------------------------------------------------------------
// Evaluation date (ported from evaluateLatestAllocationDate)
// ---------------------------------------------------------------------------

export function getEvaluationDate(trading: Trading, options: EvaluationOptions): Date {
  const series = Object.values(options.batchSeries)[0];
  if (!series || series.length === 0) {
    return options.at;
  }

  const internalSeries = toInternalSeries(series);

  const latestCloseObs = findLatestMarketCloseObs(internalSeries, options.at);
  if (!latestCloseObs) {
    return options.at;
  }

  let { start, end } = getPeriodBounds(latestCloseObs.timestamp, trading.frequency);
  let periodObs = findObservationsInPeriod(internalSeries, start, end);

  if (trading.frequency !== 'Daily') {
    const lastPeriodObs = periodObs.at(-1);
    if (lastPeriodObs) {
      const lastObsDate = lastPeriodObs.timestamp.toISOString().slice(0, 10);
      const endDate = end.toISOString().slice(0, 10);

      if (lastObsDate < endDate) {
        const prevPeriodDate = new Date(start);
        prevPeriodDate.setUTCDate(prevPeriodDate.getUTCDate() - 1);
        ({ start, end } = getPeriodBounds(prevPeriodDate, trading.frequency));
        periodObs = findObservationsInPeriod(internalSeries, start, end);
      }
    }
  }

  const index = periodObs.length - 1 - trading.offset;
  if (index < 0) {
    return periodObs[0]?.timestamp ?? options.at;
  }

  return periodObs[index].timestamp;
}

function findLatestMarketCloseObs(series: InternalObs[], cutoff: Date): InternalObs | undefined {
  for (let i = series.length - 1; i >= 0 && i >= series.length - 100; i--) {
    const obs = series[i];
    if (obs.timestamp <= cutoff && isAtMarketClose(obs.timestamp)) {
      return obs;
    }
  }
  return undefined;
}

function findObservationsInPeriod(series: InternalObs[], start: Date, end: Date): InternalObs[] {
  const result: InternalObs[] = [];
  for (let i = series.length - 1; i >= 0; i--) {
    const obs = series[i];
    if (obs.timestamp < start) break;
    if (obs.timestamp >= start && obs.timestamp <= end && isAtMarketClose(obs.timestamp)) {
      result.unshift(obs);
    }
  }
  return result;
}

function getPeriodBounds(date: Date, frequency: Trading['frequency']): { start: Date; end: Date } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  const startOfDayUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  const endOfDayUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
  const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

  switch (frequency) {
    case 'Daily':
      return { start: startOfDayUTC(year, month, day), end: endOfDayUTC(year, month, day) };
    case 'Weekly': {
      const dayOfWeek = date.getUTCDay();
      const mondayOffset = (dayOfWeek + 6) % 7;
      const monday = new Date(Date.UTC(year, month, day - mondayOffset));
      const friday = new Date(Date.UTC(
        monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 4, 23, 59, 59, 999,
      ));
      return { start: monday, end: friday };
    }
    case 'Monthly':
      return { start: startOfDayUTC(year, month, 1), end: endOfDayUTC(year, month, lastDayOfMonth(year, month)) };
    case 'Bi-monthly': {
      const ps = Math.floor(month / 2) * 2;
      const pe = ps + 1;
      return { start: startOfDayUTC(year, ps, 1), end: endOfDayUTC(year, pe, lastDayOfMonth(year, pe)) };
    }
    case 'Quarterly': {
      const ps = Math.floor(month / 3) * 3;
      const pe = ps + 2;
      return { start: startOfDayUTC(year, ps, 1), end: endOfDayUTC(year, pe, lastDayOfMonth(year, pe)) };
    }
    case 'Every 4 Months': {
      const ps = Math.floor(month / 4) * 4;
      const pe = ps + 3;
      return { start: startOfDayUTC(year, ps, 1), end: endOfDayUTC(year, pe, lastDayOfMonth(year, pe)) };
    }
    case 'Semiannually': {
      const ps = Math.floor(month / 6) * 6;
      const pe = ps + 5;
      return { start: startOfDayUTC(year, ps, 1), end: endOfDayUTC(year, pe, lastDayOfMonth(year, pe)) };
    }
    case 'Yearly':
      return { start: startOfDayUTC(year, 0, 1), end: endOfDayUTC(year, 11, 31) };
  }
}
