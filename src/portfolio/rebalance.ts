import type { Ticker } from '../strategy/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeOrder {
  action: 'BUY' | 'SELL';
  symbol: string;
  quantity: number;
  estimatedPrice: number;
  estimatedValue: number;
}

export interface RebalancePlanInput {
  targetWeights: Record<string, number>;
  currentValues: Record<string, number>;
  prices: Record<string, number>;
  quantityPrecisionBySymbol?: Record<string, number>;
  cashValue: number;
  totalValue: number;
  portfolioDriftThresholdPercentPoints?: number;
  minTradeValue?: number;
  cashReservePercent?: number;
  minCashReserveValue?: number;
  buySlippageBps?: number;
  sellSlippageBps?: number;
  perOrderFee?: number;
  /** When set, this symbol is treated as cash: no orders, no price required. */
  cashSymbol?: string;
}

export interface RebalancePlan {
  triggered: boolean;
  portfolioDriftPercentPoints: number;
  reason: 'below_threshold' | 'ok' | 'no_orders';
  orders: TradeOrder[];
}

// ---------------------------------------------------------------------------
// Constants (exported so consumers can import defaults)
// ---------------------------------------------------------------------------

/** Minimum portfolio drift (in percentage points) required before rebalancing is triggered. */
export const PORTFOLIO_DRIFT_THRESHOLD_PERCENT_POINTS = 25;
/** Ignore tiny deltas below this notional value to avoid dust trades. */
export const REBALANCE_MIN_TRADE_VALUE = 1;
/** Default quantity precision for fractionable symbols (100 = 2 decimal places). */
export const REBALANCE_QUANTITY_PRECISION = 100;
/** Quantity precision for whole-share-only symbols (1 = integer shares only). */
export const REBALANCE_WHOLE_SHARE_QUANTITY_PRECISION = 1;
/** Numeric tolerance for floating-point comparisons. */
export const REBALANCE_EPSILON = 1e-9;
/** Keep this % of cash unallocated as a safety reserve. */
export const REBALANCE_CASH_RESERVE_PERCENT = 1;
/** Absolute minimum dollar reserve kept as cash. */
export const REBALANCE_MIN_CASH_RESERVE_VALUE = 10;
/** Inflate buy pricing by this many basis points when sizing orders. */
export const REBALANCE_BUY_SLIPPAGE_BPS = 30;
/** Haircut expected sell proceeds by this many basis points when funding buys. */
export const REBALANCE_SELL_SLIPPAGE_BPS = 20;
/** Flat per-order fee assumption used in funding math. */
export const REBALANCE_PER_ORDER_FEE = 0;
/** Canonical symbol used in targetWeights when strategy holds cash. */
export const REBALANCE_CASH_SYMBOL = 'CASH';
/** Strategy ticker that means "hold as cash". */
export const REBALANCE_CASH_SOURCE_SYMBOL = 'DTB3';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertFiniteNumber(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${name}`);
  }
}

function assertNonNegative(name: string, value: unknown): asserts value is number {
  assertFiniteNumber(name, value);
  if (value < 0) {
    throw new Error(`Invalid negative value for ${name}`);
  }
}

function assertPositive(name: string, value: unknown): asserts value is number {
  assertFiniteNumber(name, value);
  if (value <= 0) {
    throw new Error(`Invalid non-positive value for ${name}`);
  }
}

function quantityFromNotional(notional: number, price: number, quantityPrecision: number): number {
  return Math.floor((notional / price) * quantityPrecision) / quantityPrecision;
}

function bpsToFraction(bps: number): number {
  return bps / 10_000;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

export function computePortfolioDriftPercentPoints(input: {
  targetWeights: Record<string, number>;
  currentValues: Record<string, number>;
  cashValue: number;
  totalValue: number;
}): number {
  const { targetWeights, currentValues, cashValue, totalValue } = input;
  assertPositive('totalValue', totalValue);
  assertNonNegative('cashValue', cashValue);

  let targetWeightSum = 0;
  for (const [symbol, weight] of Object.entries(targetWeights)) {
    assertNonNegative(`targetWeight(${symbol})`, weight);
    targetWeightSum += weight;
  }
  if (targetWeightSum > 100 + REBALANCE_EPSILON) {
    throw new Error(`Invalid target weights: sum exceeds 100 (${targetWeightSum.toFixed(4)})`);
  }

  const symbols = new Set<string>([...Object.keys(targetWeights), ...Object.keys(currentValues)]);

  let absSum = 0;
  for (const symbol of symbols) {
    const currentValue = currentValues[symbol] ?? 0;
    assertNonNegative(`currentValue(${symbol})`, currentValue);
    const currentWeight = (currentValue / totalValue) * 100;
    const targetWeight = targetWeights[symbol] ?? 0;
    absSum += Math.abs(targetWeight - currentWeight);
  }

  // Only add implicit cash when target weights don't sum to 100 (no explicit cash ticker).
  if (targetWeightSum < 100) {
    const targetCashWeight = 100 - targetWeightSum;
    const currentCashWeight = (cashValue / totalValue) * 100;
    absSum += Math.abs(targetCashWeight - currentCashWeight);
  }

  return absSum / 2;
}

export function buildRebalancePlan(input: RebalancePlanInput): RebalancePlan {
  const {
    targetWeights,
    currentValues,
    prices,
    quantityPrecisionBySymbol,
    cashValue,
    totalValue,
    portfolioDriftThresholdPercentPoints = PORTFOLIO_DRIFT_THRESHOLD_PERCENT_POINTS,
    minTradeValue = REBALANCE_MIN_TRADE_VALUE,
    cashReservePercent = REBALANCE_CASH_RESERVE_PERCENT,
    minCashReserveValue = REBALANCE_MIN_CASH_RESERVE_VALUE,
    buySlippageBps = REBALANCE_BUY_SLIPPAGE_BPS,
    sellSlippageBps = REBALANCE_SELL_SLIPPAGE_BPS,
    perOrderFee = REBALANCE_PER_ORDER_FEE,
    cashSymbol,
  } = input;

  assertPositive('totalValue', totalValue);
  assertNonNegative('cashValue', cashValue);
  assertNonNegative('portfolioDriftThresholdPercentPoints', portfolioDriftThresholdPercentPoints);
  assertNonNegative('minTradeValue', minTradeValue);
  assertNonNegative('cashReservePercent', cashReservePercent);
  assertNonNegative('minCashReserveValue', minCashReserveValue);
  assertNonNegative('buySlippageBps', buySlippageBps);
  assertNonNegative('sellSlippageBps', sellSlippageBps);
  assertNonNegative('perOrderFee', perOrderFee);
  for (const [symbol, precision] of Object.entries(quantityPrecisionBySymbol ?? {})) {
    assertPositive(`quantityPrecisionBySymbol(${symbol})`, precision);
  }

  const portfolioDriftPercentPoints = computePortfolioDriftPercentPoints({
    targetWeights,
    currentValues,
    cashValue,
    totalValue,
  });

  if (portfolioDriftPercentPoints < portfolioDriftThresholdPercentPoints) {
    return {
      triggered: false,
      portfolioDriftPercentPoints,
      reason: 'below_threshold',
      orders: [],
    };
  }

  const symbols = new Set<string>([...Object.keys(targetWeights), ...Object.keys(currentValues)]);
  const sellCandidates: Array<{ symbol: string; notional: number; price: number }> = [];
  const buyCandidates: Array<{ symbol: string; notional: number; price: number }> = [];

  for (const symbol of symbols) {
    if (cashSymbol != null && symbol === cashSymbol) continue;

    const currentValue = currentValues[symbol] ?? 0;
    assertNonNegative(`currentValue(${symbol})`, currentValue);
    const targetWeight = targetWeights[symbol] ?? 0;
    const targetValue = (targetWeight / 100) * totalValue;
    const delta = targetValue - currentValue;

    if (Math.abs(delta) <= minTradeValue) continue;

    const price = prices[symbol];
    assertPositive(`price(${symbol})`, price);

    if (delta < 0) {
      sellCandidates.push({ symbol, notional: Math.abs(delta), price });
    } else {
      buyCandidates.push({ symbol, notional: delta, price });
    }
  }

  sellCandidates.sort((a, b) => b.notional - a.notional);
  buyCandidates.sort((a, b) => b.notional - a.notional);

  const orders: TradeOrder[] = [];
  const reserveValue = Math.max(minCashReserveValue, cashValue * (cashReservePercent / 100));
  let availableFunds = Math.max(0, cashValue - reserveValue);
  const buySlippageMultiplier = 1 + bpsToFraction(buySlippageBps);
  const sellSlippageMultiplier = 1 - bpsToFraction(sellSlippageBps);

  for (const candidate of sellCandidates) {
    const quantityPrecision = quantityPrecisionBySymbol?.[candidate.symbol] ?? REBALANCE_QUANTITY_PRECISION;
    const quantity = quantityFromNotional(candidate.notional, candidate.price, quantityPrecision);
    if (quantity <= 0) continue;
    const estimatedValue = quantity * candidate.price;
    if (estimatedValue <= minTradeValue) continue;
    orders.push({
      action: 'SELL',
      symbol: candidate.symbol,
      quantity,
      estimatedPrice: candidate.price,
      estimatedValue,
    });
    const netProceeds = Math.max(0, estimatedValue * sellSlippageMultiplier - perOrderFee);
    availableFunds += netProceeds;
  }

  for (const candidate of buyCandidates) {
    if (availableFunds <= minTradeValue) break;
    const maxAffordableNotional = Math.max(0, availableFunds - perOrderFee);
    const cappedNotional = Math.min(candidate.notional, maxAffordableNotional);
    const effectiveBuyPrice = candidate.price * buySlippageMultiplier;
    const quantityPrecision = quantityPrecisionBySymbol?.[candidate.symbol] ?? REBALANCE_QUANTITY_PRECISION;
    const quantity = quantityFromNotional(cappedNotional, effectiveBuyPrice, quantityPrecision);
    if (quantity <= 0) continue;
    const estimatedValue = quantity * candidate.price;
    if (estimatedValue <= minTradeValue) continue;
    const reservedCost = quantity * effectiveBuyPrice + perOrderFee;
    if (reservedCost > availableFunds + REBALANCE_EPSILON) continue;
    orders.push({
      action: 'BUY',
      symbol: candidate.symbol,
      quantity,
      estimatedPrice: candidate.price,
      estimatedValue,
    });
    availableFunds = Math.max(0, availableFunds - reservedCost);
  }

  orders.sort((a, b) => {
    if (a.action === 'SELL' && b.action === 'BUY') return -1;
    if (a.action === 'BUY' && b.action === 'SELL') return 1;
    return 0;
  });

  return {
    triggered: true,
    portfolioDriftPercentPoints,
    reason: orders.length > 0 ? 'ok' : 'no_orders',
    orders,
  };
}
