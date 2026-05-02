// Strategy / runtime
export { runBacktest, reconcile } from './strategy';
export type {
  Strategy,
  Features,
  RunBacktestOptions,
  BacktestResult,
  BacktestSnapshot,
  TargetWeights,
  PriceMap,
} from './strategy';

// Interfaces (type surface)
export type {
  Asset,
  AssetId,
  Bar,
  DateRange,
  Frequency,
  Series,
  DataFeed,
  Fundamentals,
  EventKind,
  DataEvent,
  Executor,
  Calendar,
  FeatureCache,
  FeatureKey,
  FeatureScope,
} from './interfaces';

// Reference implementations
export { USEquityCalendar, MemoryFeatureCache, BacktestExecutor } from './reference';
export type { BacktestExecutorOptions, NextOpenFn } from './reference';

// Tactical dialect (namespace re-export + commonly-used types)
export * as tactical from './tactical';
export type {
  TacticalSpec,
  TacticalFeatureSpec,
  TacticalFeatureKind,
  RuleNode,
  AllocateNode,
  IfNode,
  Comparison,
  ComparisonOp,
  Tolerance,
  FeatureRef,
  RebalanceConfig,
  RebalanceFrequency,
  SyntheticAsset,
  AssetRef,
} from './tactical';

// Feature library (namespace re-export + commonly-used class)
export * as features from './features';
export { FeatureRuntime } from './features';
export type { FeatureRuntimeOptions } from './features';

// Orders
export type { Order, OpenOrder, CloseOrder, AdjustOrder, RebalanceOrder, Fill } from './orders';

// Portfolio
export { applyFills, applyOrders } from './portfolio';
export type { Position, Portfolio, PositionId } from './portfolio';
