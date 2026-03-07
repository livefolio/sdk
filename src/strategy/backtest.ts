import type {
  BacktestOptions,
  BacktestResult,
  BacktestTrade,
  Strategy,
} from './types';
import type { Observation, TradingDay } from '../market/types';
import { evaluate } from './evaluate';

type PositionMap = Record<string, number>;
type PricePoint = { timestamp: number; value: number };

const EPSILON = 1e-8;

function toDateYmd(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function normalizeSeries(batchSeries: Record<string, Observation[]>): Record<string, PricePoint[]> {
  const out: Record<string, PricePoint[]> = {};
  for (const [symbol, observations] of Object.entries(batchSeries)) {
    out[symbol] = observations
      .map((observation) => ({
        timestamp: new Date(observation.timestamp).getTime(),
        value: observation.value,
      }))
      .filter((observation) => Number.isFinite(observation.timestamp) && Number.isFinite(observation.value))
      .sort((a, b) => a.timestamp - b.timestamp);
  }
  return out;
}

function latestPriceAtOrBefore(series: PricePoint[], timestamp: number): number | null {
  if (!series.length) return null;
  let low = 0;
  let high = series.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].timestamp <= timestamp) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found >= 0 ? series[found].value : null;
}

function positionKey(symbol: string, leverage: number): string {
  return `${symbol}::${leverage}`;
}

function parsePositionKey(key: string): { symbol: string; leverage: number } {
  const [symbol, leverage] = key.split('::');
  return { symbol, leverage: Number(leverage) };
}

function getRequiredSymbols(strategy: Strategy): string[] {
  const symbols = new Set<string>();
  for (const ns of strategy.signals) {
    symbols.add(ns.signal.left.ticker.symbol);
    symbols.add(ns.signal.right.ticker.symbol);
  }
  for (const allocation of strategy.allocations) {
    for (const holding of allocation.allocation.holdings) {
      symbols.add(holding.ticker.symbol);
    }
  }
  return [...symbols];
}

function validateDefaultAllocation(strategy: Strategy): void {
  const defaultAllocations = strategy.allocations.filter((allocation) => allocation.name.toLowerCase() === 'default');
  if (defaultAllocations.length !== 1) {
    throw new Error('Strategy must include exactly one allocation named "Default".');
  }
}

function normalizeTradingDays(tradingDays: TradingDay[], startDate: string, endDate: string): TradingDay[] {
  return tradingDays
    .filter((day) => day.date >= startDate && day.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildLeveragedPriceSeries(
  tradingDays: TradingDay[],
  batchSeries: Record<string, Observation[]>,
  requiredPositions: Array<{ symbol: string; leverage: number }>,
): Record<string, Record<string, number>> {
  const raw = normalizeSeries(batchSeries);
  const leveragedByPosition: Record<string, Record<string, number>> = {};

  for (const { symbol, leverage } of requiredPositions) {
    const key = positionKey(symbol, leverage);
    const baseSeries = raw[symbol] ?? [];
    if (!baseSeries.length) {
      continue;
    }

    if (leverage === 1) {
      const direct: Record<string, number> = {};
      for (const day of tradingDays) {
        const closeTs = new Date(day.close).getTime();
        const price = latestPriceAtOrBefore(baseSeries, closeTs);
        if (price != null && price > 0) {
          direct[day.date] = price;
        }
      }
      leveragedByPosition[key] = direct;
      continue;
    }

    const synthetic: Record<string, number> = {};
    let previousBasePrice: number | null = null;
    let previousLeveragedPrice: number | null = null;

    for (const day of tradingDays) {
      const closeTs = new Date(day.close).getTime();
      const basePrice = latestPriceAtOrBefore(baseSeries, closeTs);
      if (basePrice == null || basePrice <= 0) {
        continue;
      }

      if (previousBasePrice == null || previousLeveragedPrice == null) {
        previousBasePrice = basePrice;
        previousLeveragedPrice = basePrice;
        synthetic[day.date] = basePrice;
        continue;
      }

      const baseReturn = (basePrice - previousBasePrice) / previousBasePrice;
      const leveragedReturn = baseReturn * leverage;
      const nextLeveragedPrice: number = previousLeveragedPrice * (1 + leveragedReturn);
      previousBasePrice = basePrice;
      previousLeveragedPrice = nextLeveragedPrice;
      synthetic[day.date] = nextLeveragedPrice;
    }

    leveragedByPosition[key] = synthetic;
  }

  return leveragedByPosition;
}

function computePortfolioValue(positions: PositionMap, pricesByPosition: Record<string, number>, cash: number): number {
  let total = cash;
  for (const [key, shares] of Object.entries(positions)) {
    const price = pricesByPosition[key];
    if (!Number.isFinite(price) || !Number.isFinite(shares)) continue;
    total += shares * price;
  }
  return total;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

export async function backtest(strategy: Strategy, options: BacktestOptions): Promise<BacktestResult> {
  validateDefaultAllocation(strategy);
  if (!options.batchSeries) {
    throw new Error('Backtest requires batchSeries in options.');
  }
  if (!options.tradingDays) {
    throw new Error('Backtest requires tradingDays in options.');
  }

  const initialCapital = options.initialCapital ?? 100_000;
  const tradingDays = normalizeTradingDays(options.tradingDays, options.startDate, options.endDate);
  if (!tradingDays.length) {
    throw new Error('No trading days in selected date range.');
  }

  const requiredPositions = new Map<string, { symbol: string; leverage: number }>();
  for (const allocation of strategy.allocations) {
    for (const holding of allocation.allocation.holdings) {
      requiredPositions.set(positionKey(holding.ticker.symbol, holding.ticker.leverage), {
        symbol: holding.ticker.symbol,
        leverage: holding.ticker.leverage,
      });
    }
  }

  const symbols = getRequiredSymbols(strategy);
  for (const symbol of symbols) {
    if (!options.batchSeries[symbol]?.length) {
      throw new Error(`Missing market series for symbol ${symbol}.`);
    }
  }

  const pricePaths = buildLeveragedPriceSeries(tradingDays, options.batchSeries, [...requiredPositions.values()]);
  const positions: PositionMap = {};
  let cash = initialCapital;
  let previousSignalStates: Record<string, boolean> = {};
  let previousIndicatorMetadata: Record<string, unknown> = {};
  let lastRebalanceDate: string | null = null;
  let runningPeak = initialCapital;

  const trades: BacktestTrade[] = [];
  const dates: string[] = [];
  const portfolioValues: number[] = [];
  const cashSeries: number[] = [];
  const drawdownPct: number[] = [];
  const allocationSeries: string[] = [];

  for (const day of tradingDays) {
    const closeAt = new Date(day.close);
    const currentDate = day.date;

    const evaluation = evaluate(strategy, {
      at: closeAt,
      batchSeries: options.batchSeries,
      previousSignalStates,
      previousIndicatorMetadata,
    });

    const pricesByPosition: Record<string, number> = {};
    for (const [key] of requiredPositions) {
      const price = pricePaths[key]?.[currentDate];
      if (price != null && Number.isFinite(price) && price > 0) {
        pricesByPosition[key] = price;
      }
    }

    const asOfDate = toDateYmd(evaluation.asOf);
    const shouldRebalance = asOfDate === currentDate && asOfDate !== lastRebalanceDate;
    if (shouldRebalance) {
      lastRebalanceDate = asOfDate;
      const totalValue = computePortfolioValue(positions, pricesByPosition, cash);
      const targetShares: Record<string, number> = {};

      for (const holding of evaluation.allocation.holdings) {
        const key = positionKey(holding.ticker.symbol, holding.ticker.leverage);
        const price = pricesByPosition[key];
        if (!Number.isFinite(price) || price <= 0) continue;
        const targetValue = totalValue * (holding.weight / 100);
        targetShares[key] = targetValue / price;
      }

      for (const [key, currentShares] of Object.entries(positions)) {
        const target = targetShares[key] ?? 0;
        const delta = target - currentShares;
        if (Math.abs(delta) <= EPSILON) continue;
        const price = pricesByPosition[key];
        if (!Number.isFinite(price) || price <= 0) continue;

        const tradeValue = delta * price;
        positions[key] = target;
        cash -= tradeValue;

        const parsed = parsePositionKey(key);
        trades.push({
          date: currentDate,
          ticker: parsed.symbol,
          leverage: parsed.leverage,
          shares: delta,
          price,
          value: tradeValue,
          action: delta > 0 ? 'buy' : 'sell',
          allocation: evaluation.allocation.name,
        });
      }

      for (const [key, target] of Object.entries(targetShares)) {
        if (key in positions) continue;
        if (Math.abs(target) <= EPSILON) continue;
        const price = pricesByPosition[key];
        if (!Number.isFinite(price) || price <= 0) continue;

        positions[key] = target;
        const tradeValue = target * price;
        cash -= tradeValue;

        const parsed = parsePositionKey(key);
        trades.push({
          date: currentDate,
          ticker: parsed.symbol,
          leverage: parsed.leverage,
          shares: target,
          price,
          value: tradeValue,
          action: 'buy',
          allocation: evaluation.allocation.name,
        });
      }

      if (Math.abs(cash) <= EPSILON) {
        cash = 0;
      }
    }

    const portfolioValue = computePortfolioValue(positions, pricesByPosition, cash);
    runningPeak = Math.max(runningPeak, portfolioValue);
    const dd = runningPeak > 0 ? ((portfolioValue - runningPeak) / runningPeak) * 100 : 0;

    dates.push(currentDate);
    portfolioValues.push(portfolioValue);
    cashSeries.push(cash);
    drawdownPct.push(dd);
    allocationSeries.push(evaluation.allocation.name);

    previousSignalStates = evaluation.signals;
    previousIndicatorMetadata = Object.fromEntries(
      Object.entries(evaluation.indicators)
        .filter(([, indicator]) => indicator.metadata !== undefined)
        .map(([key, indicator]) => [key, indicator.metadata]),
    );
  }

  const finalValue = portfolioValues.at(-1) ?? initialCapital;
  const totalReturn = initialCapital > 0 ? (finalValue - initialCapital) / initialCapital : 0;

  const dailyReturns: number[] = [];
  for (let i = 1; i < portfolioValues.length; i++) {
    const prev = portfolioValues[i - 1];
    const curr = portfolioValues[i];
    if (prev > 0) dailyReturns.push((curr - prev) / prev);
  }

  const daysSpan = Math.max(tradingDays.length - 1, 0);
  const yearsSpan = daysSpan / 252;
  const cagr = yearsSpan > 0 ? (finalValue / initialCapital) ** (1 / yearsSpan) - 1 : totalReturn;
  const volatility = standardDeviation(dailyReturns) * Math.sqrt(252);
  const meanDailyReturn =
    dailyReturns.length > 0
      ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length
      : 0;
  const sharpe = volatility > 0 ? (meanDailyReturn * Math.sqrt(252)) / volatility : 0;
  const maxDrawdown = drawdownPct.length ? Math.min(...drawdownPct) : 0;

  return {
    timeseries: {
      dates,
      portfolio: portfolioValues,
      cash: cashSeries,
      drawdownPct,
      allocation: allocationSeries,
    },
    summary: {
      initialValue: initialCapital,
      finalValue,
      totalReturnPct: totalReturn * 100,
      cagrPct: cagr * 100,
      maxDrawdownPct: maxDrawdown,
      annualizedVolatilityPct: volatility * 100,
      sharpeRatio: sharpe,
      tradeCount: trades.length,
    },
    trades,
  };
}
