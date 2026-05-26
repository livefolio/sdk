// Strategy / runtime
export { runBacktest, runLive, reconcile, CashEventQueue } from './strategy';
export type {
  Strategy,
  Features,
  CashEvent,
  DividendsConfig,
  RunBacktestOptions,
  RunLiveOptions,
  BacktestResult,
  BacktestSnapshot,
  LiveEvent,
  TargetWeights,
  PriceMap,
} from './strategy';

// Interfaces (type surface)
export type {
  Asset,
  AssetId,
  EquityAsset,
  MacroAsset,
  Bar,
  DateRange,
  DividendEvent,
  Frequency,
  Series,
  DataFeed,
  Fundamentals,
  EventKind,
  DataEvent,
  StreamingDataFeed,
  StreamingBar,
  QuoteFeed,
  Quote,
  Executor,
  Calendar,
  Session,
  TimeOfDay,
  FeatureCache,
  FeatureKey,
  FeatureScope,
} from './interfaces';

// Reference implementations
export {
  MemoryFeatureCache,
  BacktestExecutor,
  RoutingDataFeed,
  RoutingDataFeedError,
  RoutingStreamingDataFeed,
  RoutingStreamingDataFeedError,
  RoutingQuoteFeed,
  RoutingQuoteFeedError,
  pollingStreamFromHistorical,
} from './reference';
export type {
  BacktestExecutorOptions,
  NextOpenFn,
  RoutingDataFeedRouteFn,
  RoutingDataFeedRouteMap,
  RoutingStreamingDataFeedRouteFn,
  RoutingStreamingDataFeedRouteMap,
  RoutingQuoteFeedRouteFn,
  RoutingQuoteFeedRouteMap,
  PollingStreamOptions,
  PollingSchedule,
} from './reference';

// Calendars (exchange calendar framework)
export {
  ExchangeCalendar,
  NYSEExchangeCalendar,
  LSEExchangeCalendar,
  Crypto24x7Calendar,
  getCalendar,
} from './calendars';
export type { ExchangeName, HolidayRule, SpecialClose, SpecialOpen, AdhocTimeOverrides } from './calendars';

// Tactical dialect — flat exports (canonical) and namespace alias.
export {
  fromSpec,
  evaluateRuleTree,
  evaluateFeatureSpecs,
  withSynthetics,
  withStreamingSynthetics,
  isRebalanceDay,
  periodKey,
} from './tactical';
export type {
  TacticalSpec,
  TacticalFeatureSpec,
  TacticalFeatureKind,
  TacticalFeatures,
  FromSpecOptions,
  RuleNode,
  RuleTreeState,
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
  WithStreamingSyntheticsOptions,
} from './tactical';
export * as tactical from './tactical';

// Feature library — flat exports (canonical) and namespace alias.
export {
  sma,
  ema,
  rsi,
  returnSeries,
  volatility,
  drawdown,
  FeatureRuntime,
  defineFeature,
  getFeatureCompute,
  paramsHash,
  collectBars,
  barsToSeries,
  seriesAt,
} from './features';
export type { FeatureSpec, FeatureKind, FeatureRuntimeOptions, BarField, ReturnMode, ComputeFn } from './features';
export * as features from './features';

// Tax utilities — flat exports (canonical) and namespace alias.
export {
  holdingPeriodDays,
  isLongTerm,
  realize,
  selectFIFO,
  selectLIFO,
  selectHIFO,
  selectMinTax,
  bucketByTerm,
  netWithinBucket,
  crossOffset,
  aggregateByYear,
  computeTaxBill,
  ORDINARY_OFFSET_CAP,
} from './tax';
export type { LotSlice, TaxRates, TaxableIncome, RealizeResult } from './tax';
export * as tax from './tax';

// Orders
export type { Order, OpenOrder, CloseOrder, AdjustOrder, RebalanceOrder, Fill } from './orders';

// Portfolio
export { applyFills, applyOrders, positionsByAsset } from './portfolio';
export type { Position, Portfolio, PositionId, Lot, RealizedEvent, IncomeKind } from './portfolio';
