import type {
  BacktestAnnualTax,
  BacktestRebalanceConfig,
  BacktestSummary,
  Comparison,
  Frequency,
  Holding,
  IndicatorType,
  Strategy,
  Trading,
} from '../strategy/types';

export interface DraftIndicator {
  type: IndicatorType;
  ticker: string;
  lookback: number;
  delay?: number;
  threshold?: number | null;
}

export interface DraftSignal {
  name: string;
  left: DraftIndicator;
  comparison: Comparison;
  right: DraftIndicator;
  tolerance?: number;
}

export interface DraftConditionNode {
  signalName: string;
  not?: boolean;
}

export type DraftRebalanceSettings = BacktestRebalanceConfig;

export interface DraftAllocation {
  name: string;
  groups: DraftConditionNode[][];
  holdings: Holding[];
  rebalance: DraftRebalanceSettings;
}

export interface StrategyDraft {
  name: string;
  trading: Trading;
  signals: DraftSignal[];
  allocations: DraftAllocation[];
}

export interface BacktestRequest {
  draft: StrategyDraft;
  startDate: string;
  endDate: string;
  initialCapital?: number;
}

export interface BacktestTrade {
  date: string;
  ticker: string;
  shares: number;
  price: number;
  value: number;
  action: 'buy' | 'sell';
  allocation: string;
}

export interface BacktestTimeseries {
  dates: string[];
  portfolio: number[];
  drawdownPct: number[];
  allocation: string[];
}

export interface BacktestResult {
  strategy: Strategy;
  summary: BacktestSummary;
  timeseries: BacktestTimeseries;
  trades: BacktestTrade[];
  annualTax: BacktestAnnualTax[];
}

export const FREQUENCY_OPTIONS: Frequency[] = [
  'Daily',
  'Weekly',
  'Monthly',
  'Bi-monthly',
  'Quarterly',
  'Every 4 Months',
  'Semiannually',
  'Yearly',
];

export const INDICATOR_OPTIONS: IndicatorType[] = [
  'Price',
  'SMA',
  'EMA',
  'Return',
  'Volatility',
  'Drawdown',
  'RSI',
  'Threshold',
  'VIX',
];

export const REBALANCE_MODE_OPTIONS: Array<{ value: DraftRebalanceSettings['mode']; label: string }> = [
  { value: 'on_change', label: 'Never (only on allocation change)' },
  { value: 'drift', label: 'Drift based (%)' },
  { value: 'calendar', label: 'Calendar based' },
];

export const CALENDAR_REBALANCE_OPTIONS: Array<{ value: 'Daily' | 'Monthly' | 'Yearly'; label: string }> = [
  { value: 'Daily', label: 'Daily' },
  { value: 'Monthly', label: 'Monthly' },
  { value: 'Yearly', label: 'Yearly' },
];

export function emptyDraftSignal(index: number): DraftSignal {
  return {
    name: `Signal ${index}`,
    comparison: '>',
    tolerance: 0,
    left: { type: 'Price', ticker: 'SPY', lookback: 1, delay: 0, threshold: null },
    right: { type: 'SMA', ticker: 'SPY', lookback: 200, delay: 0, threshold: null },
  };
}

export function emptyDraftAllocation(signalName: string): DraftAllocation {
  return {
    name: 'Default',
    groups: [[{ signalName, not: true }]],
    holdings: [{ ticker: { symbol: 'BIL', leverage: 1 }, weight: 100 }],
    rebalance: { mode: 'on_change' },
  };
}
