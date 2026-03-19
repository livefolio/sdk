import type {
  BacktestAnnualTax,
  BacktestDebugOptions,
  BacktestOptions,
  BacktestRebalanceConfig,
  BacktestResult,
  BacktestTrade,
  Signal,
  Strategy,
  StrategyDraft,
} from './types';
import type { MarketModule, Observation, TradingDay } from '../market/types';
import { evaluate } from './evaluate';
import { compileRules } from './rules';
import { extractSymbols } from './symbols';

type PositionMap = Record<string, number>;
type PricePoint = { timestamp: number; value: number };
type TaxTerm = 'shortTerm' | 'longTerm';

const EPSILON = 1e-8;
const DEFAULT_DEBUG_LOG_EVERY_DAYS = 63;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function getDebugOptions(options: BacktestOptions): BacktestDebugOptions | null {
  if (!options.debug) return null;
  if (options.debug === true) return { logEveryDays: DEFAULT_DEBUG_LOG_EVERY_DAYS };
  const logEveryDays = Math.max(1, Math.floor(options.debug.logEveryDays ?? DEFAULT_DEBUG_LOG_EVERY_DAYS));
  return { logEveryDays };
}

function toDateYmd(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDaysToYmd(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function subtractDaysFromYmd(ymd: string, days: number): string {
  return addDaysToYmd(ymd, -days);
}

function taxYearFromDate(ymd: string): number {
  return Number(ymd.slice(0, 4));
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
  const push = (symbol: string) => {
    const normalized = symbol.trim();
    if (!normalized) return;
    symbols.add(normalized);
  };
  const pushIndicatorSymbol = (indicator: Strategy['signals'][number]['signal']['left']) => {
    if (indicator.type === 'Threshold') return;
    push(indicator.ticker.symbol);
  };
  for (const ns of strategy.signals) {
    pushIndicatorSymbol(ns.signal.left);
    pushIndicatorSymbol(ns.signal.right);
  }
  for (const allocation of strategy.allocations) {
    for (const holding of allocation.allocation.holdings) {
      push(holding.ticker.symbol);
    }
  }
  return [...symbols];
}

function maxSignalWindow(signal: Signal): number {
  const left = signal.left.lookback + signal.left.delay;
  const right = signal.right.lookback + signal.right.delay;
  return Math.max(left, right);
}

function calculateLookbackBufferDays(strategy: Strategy): number {
  let maxLookback = 0;

  for (const namedSignal of strategy.signals) {
    maxLookback = Math.max(maxLookback, maxSignalWindow(namedSignal.signal));
  }

  const visitCondition = (condition: Strategy['allocations'][number]['allocation']['condition']): void => {
    if (condition.kind === 'signal' || condition.kind === 'not') {
      maxLookback = Math.max(maxLookback, maxSignalWindow(condition.signal));
      return;
    }

    if (condition.kind === 'and') {
      for (const entry of condition.args) {
        visitCondition(entry);
      }
      return;
    }

    for (const group of condition.args) {
      visitCondition(group);
    }
  };

  for (const allocation of strategy.allocations) {
    visitCondition(allocation.allocation.condition);
  }

  return Math.ceil(maxLookback * 1.5) + 30;
}

function validateFallbackAllocation(strategy: Strategy): void {
  if (strategy.allocations.length === 0) {
    throw new Error('Strategy must include at least one allocation.');
  }
}

function normalizeTradingDays(tradingDays: TradingDay[], startDate: string, endDate: string): TradingDay[] {
  return tradingDays
    .filter((day) => day.date >= startDate && day.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function findEffectiveStartDate(
  requiredSymbols: string[],
  batchSeries: Record<string, Observation[]>,
  startDate: string,
  endDate: string,
): string {
  let effectiveStartDate = startDate;
  let effectiveEndDate = endDate;
  for (const symbol of requiredSymbols) {
    const observations = batchSeries[symbol] ?? [];
    let symbolEarliest: string | null = null;
    let symbolLatest: string | null = null;
    for (const observation of observations) {
      const timestamp = new Date(observation.timestamp);
      if (!Number.isFinite(timestamp.getTime())) continue;
      const date = toDateYmd(timestamp);
      if (date < startDate || date > endDate) continue;
      if (!symbolEarliest || date < symbolEarliest) {
        symbolEarliest = date;
      }
      if (!symbolLatest || date > symbolLatest) {
        symbolLatest = date;
      }
    }
    if (!symbolEarliest) {
      throw new Error(`No market data for symbol ${symbol} in selected date range.`);
    }
    if (symbolEarliest > effectiveStartDate) {
      effectiveStartDate = symbolEarliest;
    }
    if (symbolLatest && symbolLatest < effectiveEndDate) {
      effectiveEndDate = symbolLatest;
    }
  }
  if (effectiveStartDate > effectiveEndDate) {
    throw new Error('No overlapping market-data window across required symbols.');
  }
  return effectiveStartDate;
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

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

interface TaxLot {
  shares: number;
  costPerShare: number;
  acquiredDate: string;
}

interface RealizedTaxBreakdown {
  shortTerm: number;
  longTerm: number;
}

interface PendingWashEntry {
  saleDate: string;
  windowEndDate: string;
  remainingShares: number;
  lossPerShare: number;
  term: TaxTerm;
}

interface SoldLotChunk {
  shares: number;
  costPerShare: number;
  acquiredDate: string;
}

function isLongTermLot(acquiredDate: string, soldDate: string): boolean {
  const acquired = new Date(`${acquiredDate}T00:00:00.000Z`);
  const threshold = new Date(acquired);
  threshold.setUTCFullYear(threshold.getUTCFullYear() + 1);
  const sold = new Date(`${soldDate}T00:00:00.000Z`);
  return sold.getTime() > threshold.getTime();
}

function addAnnualTaxForTerm(
  annualTaxByYear: Map<number, RealizedTaxBreakdown>,
  year: number,
  term: TaxTerm,
  amount: number,
): void {
  const current = annualTaxByYear.get(year) ?? { shortTerm: 0, longTerm: 0 };
  current[term] += amount;
  annualTaxByYear.set(year, current);
}

function sellLotsHifo(lots: TaxLot[], sharesToSell: number): SoldLotChunk[] {
  const sorted = [...lots].sort((a, b) => b.costPerShare - a.costPerShare);
  let remaining = sharesToSell;
  const sold: SoldLotChunk[] = [];

  for (const lot of sorted) {
    if (remaining <= EPSILON) break;
    if (lot.shares <= EPSILON) continue;
    const consumed = Math.min(lot.shares, remaining);
    sold.push({
      shares: consumed,
      costPerShare: lot.costPerShare,
      acquiredDate: lot.acquiredDate,
    });
    lot.shares -= consumed;
    remaining -= consumed;
  }

  lots.length = 0;
  for (const lot of sorted) {
    if (lot.shares > EPSILON) lots.push(lot);
  }
  return sold;
}

function applyWashToExistingReplacementLots(
  lots: TaxLot[],
  soldDate: string,
  lossPerShare: number,
  sharesToMatch: number,
): number {
  if (sharesToMatch <= EPSILON) return 0;
  const windowStart = addDaysToYmd(soldDate, -30);
  let remaining = sharesToMatch;
  let matched = 0;
  const nextLots: TaxLot[] = [];

  for (const lot of lots) {
    if (remaining <= EPSILON || lot.shares <= EPSILON) {
      nextLots.push(lot);
      continue;
    }
    const inWindow = lot.acquiredDate >= windowStart && lot.acquiredDate <= soldDate;
    if (!inWindow) {
      nextLots.push(lot);
      continue;
    }

    const consumed = Math.min(lot.shares, remaining);
    if (consumed >= lot.shares - EPSILON) {
      nextLots.push({
        shares: lot.shares,
        costPerShare: lot.costPerShare + lossPerShare,
        acquiredDate: lot.acquiredDate,
      });
    } else {
      nextLots.push({
        shares: consumed,
        costPerShare: lot.costPerShare + lossPerShare,
        acquiredDate: lot.acquiredDate,
      });
      nextLots.push({
        shares: lot.shares - consumed,
        costPerShare: lot.costPerShare,
        acquiredDate: lot.acquiredDate,
      });
    }
    remaining -= consumed;
    matched += consumed;
  }

  lots.length = 0;
  for (const lot of nextLots) {
    if (lot.shares > EPSILON) lots.push(lot);
  }
  return matched;
}

function applyPendingWashToNewBuy(
  pending: PendingWashEntry[],
  buyDate: string,
  buyPrice: number,
  buyShares: number,
  annualTaxByYear: Map<number, RealizedTaxBreakdown>,
): TaxLot[] {
  const active = pending.filter(
    (entry) => entry.remainingShares > EPSILON && buyDate <= entry.windowEndDate,
  );
  pending.length = 0;
  pending.push(...active);

  let remaining = buyShares;
  const newLots: TaxLot[] = [];
  for (const entry of pending) {
    if (remaining <= EPSILON) break;
    if (entry.remainingShares <= EPSILON) continue;
    const matched = Math.min(remaining, entry.remainingShares);
    if (matched <= EPSILON) continue;

    newLots.push({
      shares: matched,
      costPerShare: buyPrice + entry.lossPerShare,
      acquiredDate: buyDate,
    });
    entry.remainingShares -= matched;
    remaining -= matched;

    addAnnualTaxForTerm(
      annualTaxByYear,
      taxYearFromDate(entry.saleDate),
      entry.term,
      matched * entry.lossPerShare,
    );
  }

  if (remaining > EPSILON) {
    newLots.push({
      shares: remaining,
      costPerShare: buyPrice,
      acquiredDate: buyDate,
    });
  }

  const unresolved = pending.filter((entry) => entry.remainingShares > EPSILON);
  pending.length = 0;
  pending.push(...unresolved);
  return newLots;
}

function isCalendarRebalanceDue(
  frequency: 'Daily' | 'Monthly' | 'Yearly',
  date: string,
  lastRebalancedDate: string | undefined,
): boolean {
  if (!lastRebalancedDate) return true;
  if (frequency === 'Daily') return date !== lastRebalancedDate;
  if (frequency === 'Monthly') return date.slice(0, 7) !== lastRebalancedDate.slice(0, 7);
  return date.slice(0, 4) !== lastRebalancedDate.slice(0, 4);
}

function getRebalanceConfig(
  allocation: Strategy['allocations'][number],
  options: BacktestOptions,
  allocationName: string,
): BacktestRebalanceConfig {
  return options.allocationRebalance?.[allocationName] ?? allocation.allocation.rebalance ?? { mode: 'on_change' };
}

function computeAllocationDriftPct(
  positions: PositionMap,
  pricesByPosition: Record<string, number>,
  targetShares: Record<string, number>,
  totalValue: number,
): number {
  if (!Number.isFinite(totalValue) || totalValue <= 0) return 0;
  let maxDrift = 0;
  const keys = new Set<string>([...Object.keys(positions), ...Object.keys(targetShares)]);
  for (const key of keys) {
    const price = pricesByPosition[key];
    if (!Number.isFinite(price) || price <= 0) continue;
    const currentValue = (positions[key] ?? 0) * price;
    const targetValue = (targetShares[key] ?? 0) * price;
    const currentWeight = (currentValue / totalValue) * 100;
    const targetWeight = (targetValue / totalValue) * 100;
    maxDrift = Math.max(maxDrift, Math.abs(currentWeight - targetWeight));
  }
  return maxDrift;
}

async function resolveBacktestInputs(
  market: Pick<MarketModule, 'getBatchSeriesFromDb' | 'getTradingDays'>,
  strategy: Strategy,
  options: BacktestOptions,
): Promise<BacktestOptions> {
  const batchSeries =
    options.batchSeries ??
    (await market.getBatchSeriesFromDb(
      extractSymbols(strategy),
      subtractDaysFromYmd(options.startDate, calculateLookbackBufferDays(strategy)),
      options.endDate,
    ));
  const tradingDays = options.tradingDays ?? (await market.getTradingDays(options.startDate, options.endDate));
  return { ...options, batchSeries, tradingDays };
}

export async function backtestWithMarketData(
  market: Pick<MarketModule, 'getBatchSeriesFromDb' | 'getTradingDays'>,
  strategy: Strategy,
  options: BacktestOptions,
): Promise<BacktestResult> {
  return backtest(strategy, await resolveBacktestInputs(market, strategy, options));
}

export async function backtestRulesWithMarketData(
  market: Pick<MarketModule, 'getBatchSeriesFromDb' | 'getTradingDays'>,
  strategyDraft: StrategyDraft,
  options: BacktestOptions,
): Promise<BacktestResult> {
  const strategy = compileRules(strategyDraft);
  return backtestWithMarketData(market, strategy, options);
}

export async function backtest(strategy: Strategy, options: BacktestOptions): Promise<BacktestResult> {
  const debug = getDebugOptions(options);
  const logEveryDays = debug?.logEveryDays ?? DEFAULT_DEBUG_LOG_EVERY_DAYS;
  const startedAt = nowMs();
  const timings = {
    validateMs: 0,
    normalizeTradingDaysMs: 0,
    buildPricePathsMs: 0,
    evaluateMs: 0,
    rebalanceMs: 0,
    bookkeepingMs: 0,
  };
  const tValidateStart = nowMs();
  validateFallbackAllocation(strategy);
  if (!options.batchSeries) {
    throw new Error('Backtest requires batchSeries in options.');
  }
  if (!options.tradingDays) {
    throw new Error('Backtest requires tradingDays in options.');
  }
  timings.validateMs = nowMs() - tValidateStart;

  const initialCapital = options.initialCapital ?? 100_000;

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
  const effectiveStartDate = findEffectiveStartDate(
    symbols,
    options.batchSeries,
    options.startDate,
    options.endDate,
  );
  const tNormalizeTradingDaysStart = nowMs();
  const tradingDays = normalizeTradingDays(options.tradingDays, effectiveStartDate, options.endDate);
  timings.normalizeTradingDaysMs = nowMs() - tNormalizeTradingDaysStart;
  if (!tradingDays.length) {
    throw new Error('No trading days in selected date range.');
  }

  const tBuildPricePathsStart = nowMs();
  const pricePaths = buildLeveragedPriceSeries(tradingDays, options.batchSeries, [...requiredPositions.values()]);
  timings.buildPricePathsMs = nowMs() - tBuildPricePathsStart;
  const positions: PositionMap = {};
  let cash = initialCapital;
  let previousSignalStates: Record<string, boolean> = {};
  let previousIndicatorMetadata: Record<string, unknown> = {};
  let previousAllocationName: string | null = null;
  const lastRebalancedDateByAllocation = new Map<string, string>();
  const lotsByPosition = new Map<string, TaxLot[]>();
  const pendingWashByPosition = new Map<string, PendingWashEntry[]>();
  const annualTaxByYear = new Map<number, RealizedTaxBreakdown>();
  let runningPeak = initialCapital;

  const trades: BacktestTrade[] = [];
  const dates: string[] = [];
  const portfolioValues: number[] = [];
  const cashSeries: number[] = [];
  const drawdownPct: number[] = [];
  const allocationSeries: string[] = [];

  for (let dayIndex = 0; dayIndex < tradingDays.length; dayIndex++) {
    const day = tradingDays[dayIndex];
    const tEvaluateStart = nowMs();
    const closeAt = new Date(day.close);
    const currentDate = day.date;

    const evaluation = evaluate(strategy, {
      at: closeAt,
      batchSeries: options.batchSeries,
      previousSignalStates,
      previousIndicatorMetadata,
    });
    timings.evaluateMs += nowMs() - tEvaluateStart;

    const pricesByPosition: Record<string, number> = {};
    for (const [key] of requiredPositions) {
      const price = pricePaths[key]?.[currentDate];
      if (price != null && Number.isFinite(price) && price > 0) {
        pricesByPosition[key] = price;
      }
    }

    const asOfDate = toDateYmd(evaluation.asOf);
    const evaluationDue = asOfDate === currentDate;
    const allocationChanged = previousAllocationName !== evaluation.allocation.name;
    const currentAllocation = strategy.allocations.find((allocation) => allocation.name === evaluation.allocation.name);
    if (!currentAllocation) {
      throw new Error(`Evaluation selected unknown allocation: ${evaluation.allocation.name}.`);
    }
    const rebalanceConfig = getRebalanceConfig(currentAllocation, options, evaluation.allocation.name);
    const lastRebalancedDate = lastRebalancedDateByAllocation.get(evaluation.allocation.name);
    let shouldRebalance = false;

    if (evaluationDue) {
      shouldRebalance = allocationChanged;
      if (!shouldRebalance) {
        if (rebalanceConfig.mode === 'calendar') {
          shouldRebalance = isCalendarRebalanceDue(rebalanceConfig.frequency, currentDate, lastRebalancedDate);
        } else if (rebalanceConfig.mode === 'drift') {
          const totalValue = computePortfolioValue(positions, pricesByPosition, cash);
          const targetSharesForDrift: Record<string, number> = {};
          for (const holding of evaluation.allocation.holdings) {
            const key = positionKey(holding.ticker.symbol, holding.ticker.leverage);
            const price = pricesByPosition[key];
            if (!Number.isFinite(price) || price <= 0) continue;
            const targetValue = totalValue * (holding.weight / 100);
            targetSharesForDrift[key] = targetValue / price;
          }
          const driftPct = computeAllocationDriftPct(
            positions,
            pricesByPosition,
            targetSharesForDrift,
            totalValue,
          );
          shouldRebalance = driftPct >= rebalanceConfig.driftPct;
        }
      }
    }

    const tRebalanceStart = nowMs();
    if (shouldRebalance) {
      lastRebalancedDateByAllocation.set(evaluation.allocation.name, currentDate);
      const totalValue = computePortfolioValue(positions, pricesByPosition, cash);
      const targetShares: Record<string, number> = {};

      for (const holding of evaluation.allocation.holdings) {
        const key = positionKey(holding.ticker.symbol, holding.ticker.leverage);
        const price = pricesByPosition[key];
        if (!Number.isFinite(price) || price <= 0) continue;
        const targetValue = totalValue * (holding.weight / 100);
        targetShares[key] = targetValue / price;
      }

      const keysToTrade = new Set<string>([...Object.keys(positions), ...Object.keys(targetShares)]);
      for (const key of keysToTrade) {
        const currentShares = positions[key] ?? 0;
        const target = targetShares[key] ?? 0;
        const delta = target - currentShares;
        if (Math.abs(delta) <= EPSILON) continue;
        const price = pricesByPosition[key];
        if (!Number.isFinite(price) || price <= 0) continue;

        const tradeValue = delta * price;
        if (Math.abs(target) <= EPSILON) {
          delete positions[key];
        } else {
          positions[key] = target;
        }
        cash -= tradeValue;

        if (delta > 0) {
          const lots = lotsByPosition.get(key) ?? [];
          const pending = pendingWashByPosition.get(key) ?? [];
          const buyLots = applyPendingWashToNewBuy(
            pending,
            currentDate,
            price,
            delta,
            annualTaxByYear,
          );
          lots.push(...buyLots);
          lotsByPosition.set(key, lots);
          pendingWashByPosition.set(key, pending);
        } else {
          const lots = lotsByPosition.get(key) ?? [];
          const soldLots = sellLotsHifo(lots, Math.abs(delta));
          lotsByPosition.set(key, lots);
          const pending = pendingWashByPosition.get(key) ?? [];

          for (const soldLot of soldLots) {
            const realized = (price - soldLot.costPerShare) * soldLot.shares;
            const term: TaxTerm = isLongTermLot(soldLot.acquiredDate, currentDate)
              ? 'longTerm'
              : 'shortTerm';

            if (realized >= 0) {
              addAnnualTaxForTerm(
                annualTaxByYear,
                taxYearFromDate(currentDate),
                term,
                realized,
              );
              continue;
            }

            const lossPerShare = soldLot.costPerShare - price;
            const preMatchedShares = applyWashToExistingReplacementLots(
              lots,
              currentDate,
              lossPerShare,
              soldLot.shares,
            );
            const disallowedPre = preMatchedShares * lossPerShare;
            const taxableNow = realized + disallowedPre;
            addAnnualTaxForTerm(
              annualTaxByYear,
              taxYearFromDate(currentDate),
              term,
              taxableNow,
            );

            const remainingForFuture = soldLot.shares - preMatchedShares;
            if (remainingForFuture > EPSILON) {
              pending.push({
                saleDate: currentDate,
                windowEndDate: addDaysToYmd(currentDate, 30),
                remainingShares: remainingForFuture,
                lossPerShare,
                term,
              });
            }
          }
          pendingWashByPosition.set(key, pending);
        }

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

      if (Math.abs(cash) <= EPSILON) {
        cash = 0;
      }
    }
    timings.rebalanceMs += nowMs() - tRebalanceStart;

    const tBookkeepingStart = nowMs();
    const portfolioValue = computePortfolioValue(positions, pricesByPosition, cash);
    runningPeak = Math.max(runningPeak, portfolioValue);
    const dd = runningPeak > 0 ? ((portfolioValue - runningPeak) / runningPeak) * 100 : 0;

    dates.push(currentDate);
    portfolioValues.push(portfolioValue);
    cashSeries.push(cash);
    drawdownPct.push(dd);
    allocationSeries.push(evaluation.allocation.name);

    previousSignalStates = evaluation.signals;
    previousAllocationName = evaluation.allocation.name;
    previousIndicatorMetadata = Object.fromEntries(
      Object.entries(evaluation.indicators)
        .filter(([, indicator]) => indicator.metadata !== undefined)
        .map(([key, indicator]) => [key, indicator.metadata]),
    );
    timings.bookkeepingMs += nowMs() - tBookkeepingStart;

    if (debug && ((dayIndex + 1) % logEveryDays === 0 || dayIndex === tradingDays.length - 1)) {
      const elapsedMs = nowMs() - startedAt;
      console.info('[sdk.backtest] progress', {
        day: dayIndex + 1,
        totalDays: tradingDays.length,
        date: currentDate,
        elapsedMs: Math.round(elapsedMs),
        trades: trades.length,
      });
    }
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
  let cagr = totalReturn;
  if (yearsSpan > 0 && initialCapital > 0 && finalValue > 0) {
    cagr = (finalValue / initialCapital) ** (1 / yearsSpan) - 1;
  }
  const volatility = standardDeviation(dailyReturns) * Math.sqrt(252);
  const meanDailyReturn =
    dailyReturns.length > 0
      ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length
      : 0;
  const annualizedReturn = meanDailyReturn * 252;
  const sharpe = volatility > 0 ? annualizedReturn / volatility : 0;
  const maxDrawdown = drawdownPct.length ? Math.min(...drawdownPct) : 0;
  const annualTax: BacktestAnnualTax[] = [...annualTaxByYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, totals]) => ({
      year,
      shortTermRealizedGains: totals.shortTerm,
      longTermRealizedGains: totals.longTerm,
    }));

  const result: BacktestResult = {
    timeseries: {
      dates,
      portfolio: portfolioValues,
      cash: cashSeries,
      drawdownPct,
      allocation: allocationSeries,
    },
    summary: {
      initialValue: initialCapital,
      finalValue: finiteOrZero(finalValue),
      totalReturnPct: finiteOrZero(totalReturn * 100),
      cagrPct: finiteOrZero(cagr * 100),
      maxDrawdownPct: finiteOrZero(maxDrawdown),
      annualizedVolatilityPct: finiteOrZero(volatility * 100),
      sharpeRatio: finiteOrZero(sharpe),
      tradeCount: trades.length,
    },
    trades,
    annualTax,
  };
  if (debug) {
    const totalMs = nowMs() - startedAt;
    console.info('[sdk.backtest] timing', {
      days: tradingDays.length,
      trades: trades.length,
      totalMs: Math.round(totalMs),
      validateMs: Math.round(timings.validateMs),
      normalizeTradingDaysMs: Math.round(timings.normalizeTradingDaysMs),
      buildPricePathsMs: Math.round(timings.buildPricePathsMs),
      evaluateMs: Math.round(timings.evaluateMs),
      rebalanceMs: Math.round(timings.rebalanceMs),
      bookkeepingMs: Math.round(timings.bookkeepingMs),
    });
  }
  return result;
}
