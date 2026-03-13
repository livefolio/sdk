import type { Allocation } from '../strategy/types';

// ---------------------------------------------------------------------------
// Broker abstraction
// ---------------------------------------------------------------------------

export interface BrokerOperations {
  getHoldings(accountId: string): Promise<HoldingsData>;
  getQuotes(accountId: string, symbols: string[]): Promise<QuoteData[]>;
  listInstruments(brokerageSlug: string): Promise<InstrumentData[]>;
  placeOrder(accountId: string, order: PlaceOrderInput): Promise<PlaceOrderResult>;
  getOrderDetail(accountId: string, brokerageOrderId: string): Promise<OrderDetailData>;
}

export interface HoldingsData {
  positions: Array<{
    symbol?: { symbol?: { id?: string; symbol?: string; exchange?: { mic_code?: string; code?: string } } };
    currency?: { code?: string };
    units?: number;
    price?: number;
    cash_equivalent?: boolean;
  }>;
  balances: Array<{ cash?: number }>;
  account?: { brokerage_authorization?: unknown };
}

export interface QuoteData {
  symbol: string;
  lastTradePrice: number;
}

export interface InstrumentData {
  symbol?: string;
  fractionable?: boolean;
}

export interface PlaceOrderInput {
  action: 'BUY' | 'SELL';
  symbol: string;
  quantity: number;
}

export interface PlaceOrderResult {
  brokerageOrderId?: string;
  response?: unknown;
}

export interface OrderDetailData {
  status?: string;
  total_quantity?: unknown;
  open_quantity?: unknown;
  filled_quantity?: unknown;
}

// ---------------------------------------------------------------------------
// Trade types
// ---------------------------------------------------------------------------

export interface TradeOrder {
  action: 'BUY' | 'SELL';
  symbol: string;
  quantity: number;
  estimatedPrice: number | null;
  estimatedValue: number | null;
}

export interface StoredOrder {
  id: number;
  batchId: string;
  userId: string;
  strategyId: number;
  accountId: string;
  allocationName: string;
  action: 'BUY' | 'SELL';
  symbol: string;
  quantity: number;
  estimatedPrice: number | null;
  estimatedValue: number | null;
  status: 'confirmed' | 'rejected' | 'expired' | null;
  expiresAt: Date;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  snaptradeOrderId: string | null;
  snaptradeResponse: unknown | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PendingBatch {
  batchId: string;
  allocationName: string;
  expiresAt: Date;
  orders: StoredOrder[];
}

export interface ExecutionResults {
  results: Map<number, OrderExecutionResult>;
}

export interface OrderExecutionResult {
  snaptradeOrderId?: string;
  snaptradeResponse?: unknown;
  error?: string;
}

export interface CreateOrdersParams {
  strategyId: number;
  accountId: string;
  allocationName: string;
  orders: TradeOrder[];
  expiresAt: Date;
}

export interface AutoDeploy {
  userId: string;
  strategyId: number;
  strategyLinkId: string;
  accountId: string;
  waitlisted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Module interface
// ---------------------------------------------------------------------------

export interface AutoDeployModule {
  calculateRequiredTrades(accountId: string, allocation: Allocation): Promise<TradeOrder[]>;
  createPendingOrders(params: CreateOrdersParams): Promise<PendingBatch>;
  listPendingBatches(strategyLinkId: string): Promise<PendingBatch[]>;
  confirmBatch(batchId: string): Promise<ExecutionResults>;
  rejectBatch(batchId: string): Promise<void>;
  hasSlot(): Promise<boolean>;
  tryClaimSlot(): Promise<boolean>;
  enable(strategyId: number, accountId: string): Promise<void>;
  disable(strategyId: number): Promise<void>;
  list(): Promise<AutoDeploy[]>;
  hasOrderHistory(strategyId: number, accountId: string): Promise<boolean>;
}
