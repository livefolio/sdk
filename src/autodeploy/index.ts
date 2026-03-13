export type {
  AutoDeployModule,
  BrokerOperations,
  HoldingsData,
  QuoteData,
  InstrumentData,
  PlaceOrderInput,
  PlaceOrderResult,
  OrderDetailData,
  TradeOrder,
  StoredOrder,
  PendingBatch,
  ExecutionResults,
  OrderExecutionResult,
  CreateOrdersParams,
  AutoDeploy,
} from './types';

export { createAutoDeploy, type AutoDeployConfig } from './client';
export {
  mapTickerToBrokerable,
  buildTargetWeights,
  buildQuantityPrecisionBySymbol,
  extractBrokerageSlug,
  calculateRequiredTrades,
  FRED_BROKERABLE_MAP,
  BASE_TICKER_ALIASES,
  LEVERAGED_ETF_MAP,
} from './trades';
export { executeSingleOrder, executeTradeOrders } from './execute';
export {
  hasAutoDeploySlot,
  tryClaimAutoDeploySlot,
  upsertAutoDeploy,
  deleteAutoDeployByUserAndStrategy,
  selectAutoDeploysByUserId,
  hasAnyOrderHistory,
  insertPendingOrderBatch,
  selectPendingOrderBatchesByUserAndStrategy,
  claimExecutableOrderBatch,
  finalizeClaimedOrderRow,
  rejectPendingOrderBatch,
  ORDER_EXECUTION_CLAIM_STALE_MS,
  mapStoredOrder,
} from './storage';
