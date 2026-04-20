export { createClient } from './client';
export type { LivefolioClient, LivefolioClientOptions } from './client';
export type { StorageProvider } from './providers/storage';
export type { MarketProvider } from './providers/market';
export type { PriceStream, StreamStatus } from './providers/price-stream';
export type {
  IndicatorType,
  TradingFreq,
  Comparison,
  Unit,
  StrategyDefinition,
  StrategySeriesEntry,
  StrategyReferenceData,
  StrategyRuleDefinition,
} from './providers/types';
export { TickerHandle } from './handles/ticker';
export { IndicatorHandle } from './handles/indicator';
export type { IndicatorIdentity, DateRange, DailyBar } from './handles/indicator';
export { SignalHandle } from './handles/signal';
export type { SignalIdentity } from './handles/signal';
export { AllocationHandle } from './handles/allocation';
export { StrategyHandle } from './handles/strategy';
export { PortfolioHandle } from './handles/portfolio';
export type { StrategyRule, StrategyBar, StrategyOptions } from './handles/strategy';
export { SimulationHandle } from './backtest/types';
export type {
  SimulateOptions,
  Trade,
  PortfolioSnapshot,
  LivePreviewState,
  StrategyLiveState,
  LiveRuleState,
  LiveSignalState,
  LiveEvaluator,
} from './backtest/types';
