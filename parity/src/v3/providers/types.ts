export type IndicatorType =
  | 'Price'
  | 'SMA'
  | 'EMA'
  | 'RSI'
  | 'Return'
  | 'Volatility'
  | 'Drawdown'
  | 'VIX'
  | 'VIX3M'
  | 'T3M'
  | 'T6M'
  | 'T1Y'
  | 'T2Y'
  | 'T3Y'
  | 'T5Y'
  | 'T7Y'
  | 'T10Y'
  | 'T20Y'
  | 'T30Y'
  | 'Month'
  | 'Day of Week'
  | 'Day of Month'
  | 'Day of Year'
  | 'Threshold';

export type TradingFreq =
  | 'Daily'
  | 'Weekly'
  | 'Monthly'
  | 'Bi-monthly'
  | 'Quarterly'
  | 'Every 4 Months'
  | 'Semiannually'
  | 'Yearly';

export type Comparison = '>' | '<' | '=';

export type Unit = '%' | 'bps' | 'std';

export interface TickerIdentity {
  symbol: string;
  leverage: number;
}

export interface StrategySeriesEntry {
  date: string;
  allocationId: number;
}

export interface StrategyRuleDefinition {
  signalIds?: number[];
  allocationId: number;
}

export interface StrategyDefinition {
  linkId: string;
  name: string;
  freq: TradingFreq;
  offset: number;
  rules: StrategyRuleDefinition[];
}

export interface StrategyReferenceData {
  id: number;
  name: string;
  freq: TradingFreq;
  offset: number;
  rules: {
    signals: {
      id: number;
      indicatorId1: number;
      indicatorId2: number;
      comparison: Comparison;
      tolerance: number;
    }[];
    allocations: { id: number; holdings: Record<string, number> }[];
    indicators: {
      id: number;
      type: IndicatorType;
      tickerId: number | null;
      lookback: number;
      delay: number;
      unit: Unit | null;
      threshold: number | null;
    }[];
    tickers: { id: number; symbol: string; leverage: number }[];
    definition: StrategyRuleDefinition[];
  };
}
