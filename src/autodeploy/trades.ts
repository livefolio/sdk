import type { Allocation, Ticker } from '../strategy/types';
import {
  buildRebalancePlan,
  REBALANCE_CASH_SYMBOL,
  REBALANCE_CASH_SOURCE_SYMBOL,
  REBALANCE_QUANTITY_PRECISION,
  REBALANCE_WHOLE_SHARE_QUANTITY_PRECISION,
  PORTFOLIO_DRIFT_THRESHOLD_PERCENT_POINTS,
} from '../portfolio/rebalance';
import type { BrokerOperations, HoldingsData, TradeOrder } from './types';

// ---------------------------------------------------------------------------
// Symbol mapping constants
// ---------------------------------------------------------------------------

/** Maps FRED rate symbols to brokerable equivalents. `null` = hold as cash. */
export const FRED_BROKERABLE_MAP: Record<string, string | null> = {
  DTB3: null,
  DFF: 'USFR',
};

/** Normalizes equivalent base tickers to a canonical symbol for leverage lookups. */
export const BASE_TICKER_ALIASES: Record<string, string> = {
  VOO: 'SPY',
  IVV: 'SPY',
};

/** Maps "SYMBOL:LEVERAGE" to the actual leveraged ETF ticker. */
export const LEVERAGED_ETF_MAP: Record<string, string> = {
  'SPY:2': 'SSO',
  'SPY:3': 'UPRO',
  'QQQ:2': 'QLD',
  'QQQ:3': 'TQQQ',
  'IWM:2': 'UWM',
  'IWM:3': 'TNA',
  'TLT:2': 'UBT',
  'TLT:3': 'TMF',
  'GLD:2': 'UGL',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isValidNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function buildPositionIdentityKey(position: {
  symbol?: { symbol?: { id?: string; symbol?: string; exchange?: { mic_code?: string; code?: string } } };
  currency?: { code?: string };
}): string | null {
  const universalSymbol = position.symbol?.symbol;
  const symbol = universalSymbol?.symbol;
  if (!symbol) return null;
  const universalId = universalSymbol?.id?.trim();
  const exchangeCode = universalSymbol?.exchange?.mic_code ?? universalSymbol?.exchange?.code ?? 'UNKNOWN_EXCHANGE';
  const positionCurrency = position.currency?.code ?? 'UNKNOWN_CURRENCY';

  if (universalId) {
    return `id:${universalId}|ccy:${positionCurrency}`;
  }

  return `symbol:${symbol}|exchange:${exchangeCode}|ccy:${positionCurrency}`;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Maps a strategy ticker to its brokerable symbol.
 * Pipeline: FRED mapping -> leveraged ETF lookup (with alias normalization) -> passthrough.
 */
export function mapTickerToBrokerable(ticker: Ticker): string | null {
  const { symbol, leverage } = ticker;

  // FRED mapping takes priority
  if (symbol in FRED_BROKERABLE_MAP) return FRED_BROKERABLE_MAP[symbol];

  // Leveraged ETF lookup
  if (leverage > 1) {
    const canonical = BASE_TICKER_ALIASES[symbol] ?? symbol;
    const key = `${canonical}:${leverage}`;
    const mapped = LEVERAGED_ETF_MAP[key];
    if (mapped) return mapped;
    console.warn(`No leveraged ETF mapping for ${symbol} at ${leverage}x — passing through as ${symbol}`);
  }

  return symbol;
}

/**
 * Build target weight map from an allocation's holdings.
 * Tickers are mapped to brokerable symbols; FRED cash sources become REBALANCE_CASH_SYMBOL.
 */
export function buildTargetWeights(allocation: Allocation): Map<string, number> {
  const targetWeights = new Map<string, number>();
  for (const holding of allocation.holdings) {
    if (!isValidNonNegativeNumber(holding.weight)) {
      throw new Error(`Invalid target weight for ${holding.ticker.symbol}`);
    }
    const mapped = mapTickerToBrokerable(holding.ticker);
    if (mapped === null) {
      if (holding.ticker.symbol === REBALANCE_CASH_SOURCE_SYMBOL) {
        targetWeights.set(REBALANCE_CASH_SYMBOL, (targetWeights.get(REBALANCE_CASH_SYMBOL) ?? 0) + holding.weight);
      }
      continue;
    }
    targetWeights.set(mapped, (targetWeights.get(mapped) ?? 0) + holding.weight);
  }
  return targetWeights;
}

/**
 * Build quantity precision map for the given symbols using broker instrument data.
 */
export async function buildQuantityPrecisionBySymbol(
  broker: BrokerOperations,
  brokerageSlug: string | undefined,
  symbols: Set<string>,
): Promise<Map<string, number>> {
  const precisionBySymbol = new Map<string, number>();
  for (const symbol of symbols) {
    precisionBySymbol.set(symbol, REBALANCE_QUANTITY_PRECISION);
  }

  if (!brokerageSlug || symbols.size === 0) {
    return precisionBySymbol;
  }

  try {
    const instruments = await broker.listInstruments(brokerageSlug);

    for (const symbol of symbols) {
      const candidates = instruments.filter((instrument) => instrument.symbol === symbol);
      if (candidates.length === 0) continue;
      const knownFractionableFlags = candidates
        .map((candidate) => candidate.fractionable)
        .filter((flag): flag is boolean => typeof flag === 'boolean');

      if (knownFractionableFlags.length === 0) {
        precisionBySymbol.set(symbol, REBALANCE_WHOLE_SHARE_QUANTITY_PRECISION);
        continue;
      }

      const allFractionable = knownFractionableFlags.every((flag) => flag);
      if (allFractionable) {
        precisionBySymbol.set(symbol, REBALANCE_QUANTITY_PRECISION);
      } else {
        precisionBySymbol.set(symbol, REBALANCE_WHOLE_SHARE_QUANTITY_PRECISION);
      }
    }
  } catch {
    // Fall back to defaults on instrument fetch failure
  }

  return precisionBySymbol;
}

/**
 * Extract brokerage slug from holdings data.
 */
export function extractBrokerageSlug(holdings: HoldingsData): string | undefined {
  const brokerageAuthorization = holdings.account?.brokerage_authorization;
  if (
    brokerageAuthorization &&
    typeof brokerageAuthorization === 'object' &&
    'brokerage' in brokerageAuthorization &&
    brokerageAuthorization.brokerage &&
    typeof brokerageAuthorization.brokerage === 'object' &&
    'slug' in brokerageAuthorization.brokerage &&
    typeof brokerageAuthorization.brokerage.slug === 'string'
  ) {
    return brokerageAuthorization.brokerage.slug;
  }
  return undefined;
}

/**
 * Calculate the trades needed to move from current positions to the target allocation.
 * Uses the broker interface for holdings data, quotes, and instrument info.
 */
export async function calculateRequiredTrades(
  broker: BrokerOperations,
  accountId: string,
  allocation: Allocation,
): Promise<TradeOrder[]> {
  const holdings = await broker.getHoldings(accountId);

  const positions = holdings.positions ?? [];
  const balances = holdings.balances ?? [];
  const brokerageSlug = extractBrokerageSlug(holdings);

  // Build current positions map: symbol -> aggregated { units, price }.
  const currentPositions = new Map<string, { units: number; price: number }>();
  const seenPositionKeys = new Set<string>();
  for (const pos of positions) {
    const symbol = pos.symbol?.symbol?.symbol;
    if (!symbol) continue;
    if (pos.cash_equivalent) continue;
    const positionKey = buildPositionIdentityKey(pos);
    if (positionKey && seenPositionKeys.has(positionKey)) {
      throw new Error(`Duplicate holding row detected for symbol ${symbol}`);
    }
    if (positionKey) {
      seenPositionKeys.add(positionKey);
    }
    if (!isValidPositiveNumber(pos.units) || !isValidPositiveNumber(pos.price)) {
      throw new Error(`Invalid holdings data for symbol ${symbol}`);
    }
    const existing = currentPositions.get(symbol);
    if (!existing) {
      currentPositions.set(symbol, { units: pos.units, price: pos.price });
      continue;
    }
    const totalMarketValue = existing.units * existing.price + pos.units * pos.price;
    const totalUnits = existing.units + pos.units;
    if (!isValidPositiveNumber(totalUnits)) {
      throw new Error(`Invalid aggregated holdings data for symbol ${symbol}`);
    }
    currentPositions.set(symbol, { units: totalUnits, price: totalMarketValue / totalUnits });
  }

  // Calculate total account value: positions market value + cash
  let totalValue = 0;
  let cashValue = 0;
  for (const position of currentPositions.values()) {
    totalValue += position.units * position.price;
  }
  for (const bal of balances) {
    if (bal.cash == null) continue;
    if (!isValidNonNegativeNumber(bal.cash)) {
      throw new Error('Invalid cash balance data');
    }
    totalValue += bal.cash;
    cashValue += bal.cash;
  }
  if (totalValue <= 0) return [];

  // Build target allocation map
  const targetWeights = buildTargetWeights(allocation);

  // Fetch live prices for target symbols not in current positions
  const missingSymbols = [...targetWeights.keys()].filter(
    (s) => s !== REBALANCE_CASH_SYMBOL && !currentPositions.has(s),
  );

  const quotes = missingSymbols.length > 0 ? await broker.getQuotes(accountId, missingSymbols) : [];
  const quotesBySymbol = new Map(quotes.map((q) => [q.symbol, q.lastTradePrice]));

  for (const symbol of missingSymbols) {
    const price = quotesBySymbol.get(symbol);
    if (!isValidPositiveNumber(price)) {
      throw new Error(`Missing or invalid market price for target symbol ${symbol}`);
    }
  }

  const currentValues: Record<string, number> = {};
  const prices: Record<string, number> = {};

  for (const [symbol, position] of currentPositions) {
    currentValues[symbol] = position.units * position.price;
    prices[symbol] = position.price;
  }
  for (const symbol of missingSymbols) {
    prices[symbol] = quotesBySymbol.get(symbol)!;
  }

  // When strategy includes cash as a ticker, rebalance plan needs current value for drift
  if (targetWeights.has(REBALANCE_CASH_SYMBOL)) {
    currentValues[REBALANCE_CASH_SYMBOL] = cashValue;
  }

  const allSymbols = new Set<string>(
    [...targetWeights.keys(), ...Object.keys(currentValues)].filter((s) => s !== REBALANCE_CASH_SYMBOL),
  );
  const quantityPrecisionBySymbol = await buildQuantityPrecisionBySymbol(broker, brokerageSlug, allSymbols);

  const targetWeightsRecord: Record<string, number> = {};
  for (const [k, v] of targetWeights) {
    targetWeightsRecord[k] = v;
  }
  const quantityPrecisionRecord: Record<string, number> = {};
  for (const [k, v] of quantityPrecisionBySymbol) {
    quantityPrecisionRecord[k] = v;
  }

  const plan = buildRebalancePlan({
    targetWeights: targetWeightsRecord,
    currentValues,
    prices,
    quantityPrecisionBySymbol: quantityPrecisionRecord,
    cashValue,
    totalValue,
    portfolioDriftThresholdPercentPoints: PORTFOLIO_DRIFT_THRESHOLD_PERCENT_POINTS,
    cashSymbol: REBALANCE_CASH_SYMBOL,
  });

  return plan.orders;
}
