import type { Observation } from '../market/types';
import type {
  AllocationEvaluation,
  Frequency,
  Holding,
  PerformancePoint,
  SimulationInput,
  Strategy,
} from './types';
import { evaluate as evaluatePure } from './evaluate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isRebalanceDay(
  tradingDay: Date,
  frequency: Frequency,
  offset: number,
  startDate: Date,
): boolean {
  const dayOfWeek = tradingDay.getUTCDay();
  const date = tradingDay.getUTCDate();
  const month = tradingDay.getUTCMonth();

  switch (frequency) {
    case 'Daily':
      return true;
    case 'Weekly':
      return dayOfWeek === offset;
    case 'Monthly':
      return date === offset;
    case 'Bi-monthly':
      return month % 2 === 0 && date === offset;
    case 'Quarterly':
      return month % 3 === 0 && date === offset;
    case 'Every 4 Months':
      return month % 4 === 0 && date === offset;
    case 'Semiannually':
      return month % 6 === 0 && date === offset;
    case 'Yearly':
      return month === startDate.getUTCMonth() && date === startDate.getUTCDate();
    default:
      return false;
  }
}

function calculatePortfolioReturn(
  holdings: Holding[],
  executionPrices: Record<string, Record<string, number>>,
  previousDate: string,
  currentDate: string,
): number {
  let portfolioReturn = 0;

  for (const holding of holdings) {
    const symbol = holding.ticker.symbol;
    const weight = holding.weight / 100;
    const symbolPrices = executionPrices[symbol];
    if (!symbolPrices) continue;

    const prevPrice = symbolPrices[previousDate];
    const currPrice = symbolPrices[currentDate];
    if (prevPrice == null || currPrice == null || prevPrice === 0) continue;

    portfolioReturn += weight * ((currPrice - prevPrice) / prevPrice);
  }

  return portfolioReturn;
}

function buildExecutionPricesFromSeries(
  batchSeries: Record<string, Observation[]>,
): Record<string, Record<string, number>> {
  const prices: Record<string, Record<string, number>> = {};
  for (const [symbol, series] of Object.entries(batchSeries)) {
    const dateMap: Record<string, number> = {};
    for (const obs of series) {
      const date = obs.timestamp.slice(0, 10);
      dateMap[date] = obs.value;
    }
    prices[symbol] = dateMap;
  }
  return prices;
}

// ---------------------------------------------------------------------------
// Pure simulation
// ---------------------------------------------------------------------------

export function simulate(input: SimulationInput): PerformancePoint[] {
  const { strategy, tradingDays, batchSeries } = input;
  const executionPrices = input.executionPrices ?? buildExecutionPricesFromSeries(batchSeries);

  if (tradingDays.length === 0) return [];

  const points: PerformancePoint[] = [];
  let portfolioValue = 100;
  let activeAllocation: AllocationEvaluation | null = null;
  let previousSignalStates: Record<string, boolean> = {};
  const startDate = new Date(tradingDays[0] + 'T00:00:00Z');

  for (const dateStr of tradingDays) {
    // Evaluate strategy at market close time (21:00 UTC ≈ 4PM ET)
    const at = new Date(dateStr + 'T21:00:00.000Z');
    const result = evaluatePure(strategy, {
      at,
      batchSeries,
      previousSignalStates,
    });

    const targetAllocation = result.allocation;
    previousSignalStates = result.signals;

    // Calculate portfolio return using active (previous) allocation
    if (activeAllocation && points.length > 0) {
      const previousDate = points[points.length - 1].date;
      const portfolioReturn = calculatePortfolioReturn(
        activeAllocation.holdings,
        executionPrices,
        previousDate,
        dateStr,
      );
      portfolioValue = portfolioValue * (1 + portfolioReturn);
    }

    // Check if we need to switch allocation
    const executionDate = new Date(dateStr + 'T21:00:00.000Z');
    const shouldRebalance = isRebalanceDay(
      executionDate,
      strategy.trading.frequency,
      strategy.trading.offset,
      startDate,
    );
    const allocationChanged = !activeAllocation || activeAllocation.name !== targetAllocation.name;

    if (shouldRebalance || allocationChanged) {
      activeAllocation = targetAllocation;
    }

    points.push({
      date: dateStr,
      value: portfolioValue,
      allocation: activeAllocation?.name ?? targetAllocation.name,
    });
  }

  return points;
}
