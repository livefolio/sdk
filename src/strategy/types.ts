import type { Observation } from '../market/types';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Comparison = '>' | '<' | '=';

export type IndicatorType =
  | 'SMA'
  | 'EMA'
  | 'Price'
  | 'Return'
  | 'Volatility'
  | 'Drawdown'
  | 'RSI'
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

export type Frequency =
  | 'Daily'
  | 'Weekly'
  | 'Monthly'
  | 'Bi-monthly'
  | 'Quarterly'
  | 'Every 4 Months'
  | 'Semiannually'
  | 'Yearly';

export type Unit = '%' | '$' | null;

// ---------------------------------------------------------------------------
// Definition types (strategy-agnostic)
// ---------------------------------------------------------------------------

export interface Ticker {
  symbol: string;
  leverage: number;
}

export interface Indicator {
  type: IndicatorType;
  ticker: Ticker;
  lookback: number;
  delay: number;
  unit: Unit;
  threshold: number | null;
}

export interface Signal {
  left: Indicator;
  comparison: Comparison;
  right: Indicator;
  tolerance: number;
}

export interface Holding {
  ticker: Ticker;
  weight: number;
}

export interface Allocation {
  condition: Condition;
  holdings: Holding[];
}

// ---------------------------------------------------------------------------
// Condition expression tree (references Signal definitions, not names)
// ---------------------------------------------------------------------------

export interface SignalExpr {
  kind: 'signal';
  signal: Signal;
}

export interface NotExpr {
  kind: 'not';
  signal: Signal;
}

export type UnaryExpr = SignalExpr | NotExpr;

export interface AndExpr {
  kind: 'and';
  args: UnaryExpr[];
}

export interface OrExpr {
  kind: 'or';
  args: AndExpr[];
}

export type Condition = OrExpr | AndExpr | UnaryExpr;

// ---------------------------------------------------------------------------
// Named instances (strategy-scoped)
// ---------------------------------------------------------------------------

export interface NamedSignal {
  name: string;
  signal: Signal;
}

export interface NamedAllocation {
  name: string;
  allocation: Allocation;
}

// ---------------------------------------------------------------------------
// Strategy (fully resolved, ready for evaluation)
// ---------------------------------------------------------------------------

export interface Trading {
  frequency: Frequency;
  offset: number;
}

export interface Strategy {
  linkId: string;
  name: string;
  trading: Trading;
  allocations: NamedAllocation[];
  signals: NamedSignal[];
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface EvaluationOptions {
  at: Date;
  batchSeries: Record<string, Observation[]>;
  previousSignalStates?: Record<string, boolean>;
  previousIndicatorMetadata?: Record<string, unknown>;
}

export interface IndicatorEvaluation {
  timestamp: string;
  value: number;
  metadata?: unknown;
}

export interface AllocationEvaluation {
  name: string;
  holdings: Holding[];
}

export interface StrategyEvaluation {
  asOf: Date;
  allocation: AllocationEvaluation;
  signals: Record<string, boolean>;
  indicators: Record<string, IndicatorEvaluation>;
}

// ---------------------------------------------------------------------------
// Live streaming
// ---------------------------------------------------------------------------

export interface StreamObservation {
  symbol: string;
  timestamp: string; // ISO 8601
  value: number;
}

// ---------------------------------------------------------------------------
// Backtest (stub)
// ---------------------------------------------------------------------------

export interface BacktestOptions {
  startDate: string;
  endDate: string;
}

export interface BacktestResult {}

// ---------------------------------------------------------------------------
// Module interface
// ---------------------------------------------------------------------------

export interface StrategyModule {
  // Retrieval
  get(linkId: string): Promise<Strategy | null>;
  getMany(linkIds: string[]): Promise<Record<string, Strategy>>;

  // Cache-through evaluation (async, self-contained — fetches series, checks cache, evaluates on miss)
  evaluate(strategy: Strategy, at: Date): Promise<StrategyEvaluation>;

  // Pure evaluation (sync, no DB, for testing/advanced use)
  evaluateIndicator(indicator: Indicator, options: EvaluationOptions): IndicatorEvaluation;
  evaluateSignal(signal: Signal, options: EvaluationOptions): boolean;
  evaluateAllocation(allocation: Allocation, options: EvaluationOptions): boolean;

  // Evaluation date
  getEvaluationDate(trading: Trading, options: EvaluationOptions): Date;

  // Utilities
  extractSymbols(strategy: Strategy): string[];

  // Live streaming (evaluate with incoming observations merged into historical series)
  stream(strategy: Strategy, observation: StreamObservation | StreamObservation[]): Promise<StrategyEvaluation>;

  // Backtest (stub)
  backtest(strategy: Strategy, options: BacktestOptions): Promise<BacktestResult>;
}
