import type { Indicator, IndicatorType, Strategy } from './types';

export const INDICATOR_SYMBOL_MAP: Partial<Record<IndicatorType, string>> = {
  VIX: '^VIX',
  VIX3M: '^VIX3M',
  T3M: 'DGS3MO',
  T6M: 'DGS6MO',
  T1Y: 'DGS1',
  T2Y: 'DGS2',
  T3Y: 'DGS3',
  T5Y: 'DGS5',
  T7Y: 'DGS7',
  T10Y: 'DGS10',
  T20Y: 'DGS20',
  T30Y: 'DGS30',
};

function addIndicatorSymbol(indicator: Indicator, symbols: Set<string>): void {
  const mappedSymbol = INDICATOR_SYMBOL_MAP[indicator.type];
  if (mappedSymbol) {
    symbols.add(mappedSymbol);
  } else if (indicator.type !== 'Threshold') {
    symbols.add(indicator.ticker.symbol);
  }
}

export function extractSymbols(strategy: Strategy): string[] {
  const symbols = new Set<string>();

  for (const signal of Object.values(strategy.signals)) {
    addIndicatorSymbol(signal.left, symbols);
    addIndicatorSymbol(signal.right, symbols);
  }

  for (const allocation of Object.values(strategy.allocations)) {
    for (const holding of allocation.holdings) {
      symbols.add(holding.ticker.symbol);
    }
  }

  return [...symbols];
}
