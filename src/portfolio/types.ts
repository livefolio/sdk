import type { Ticker } from '../strategy/types';
import type { RebalancePlanInput, RebalancePlan } from './rebalance';

// ---------------------------------------------------------------------------
// Broker types
// ---------------------------------------------------------------------------

export interface BrokerageAccount {
  id: string;
  name: string | null;
  number: string;
  institutionName: string;
  balance: { amount: number; currency: string } | null;
  isPaper: boolean;
}

export interface BrokerageConnection {
  authorizationId: string;
  brokerageName: string;
  logoUrl: string | null;
  disabled: boolean;
  type: string | null;
  accounts: BrokerageAccount[];
}

export interface Portfolio {
  balancesByCurrency: Array<{ currency: string | null; cash: number | null; buyingPower: number | null }>;
  positions: Array<{ symbol: string | null; units: number | null; price: number | null; marketValue: number | null }>;
}

export interface OrderResult {
  snaptradeOrderId?: string;
  snaptradeResponse?: unknown;
  error?: string;
}

export interface ActivityOptions {
  startDate?: string;
  endDate?: string;
  offset?: number;
  limit?: number;
  type?: string;
}

export interface TradeImpactOptions {
  action: 'BUY' | 'SELL';
  universalSymbolId: string;
  orderType: 'Limit' | 'Market' | 'StopLimit' | 'Stop';
  timeInForce: 'FOK' | 'Day' | 'GTC' | 'IOC';
  price?: number;
  stop?: number;
  units?: number;
  notionalValue?: number;
}

export interface PlaceOrderInput {
  action: 'BUY' | 'SELL';
  symbol: string;
  units: number;
  orderType?: 'Market' | 'Limit';
  timeInForce?: 'Day' | 'GTC';
}

export interface ConnectionUrlOptions {
  customRedirect: string;
  connectionType?: 'read' | 'trade' | 'trade-if-available';
}

// ---------------------------------------------------------------------------
// Module interface
// ---------------------------------------------------------------------------

export interface PortfolioModule {
  // Pure planning
  buildRebalancePlan(input: RebalancePlanInput): RebalancePlan;
  computePortfolioDriftPercentPoints(input: {
    targetWeights: Map<string, number>;
    currentValues: Map<string, number>;
    cashValue: number;
    totalValue: number;
  }): number;
  mapTickerToBrokerable(ticker: Ticker): string | null;

  // Broker — read
  getConnections(userId: string): Promise<BrokerageConnection[]>;
  getHoldings(userId: string, accountId: string): Promise<Portfolio>;
  getActivities(userId: string, accountId: string, options?: ActivityOptions): Promise<unknown>;
  getRecentOrders(userId: string, accountId: string): Promise<unknown>;
  searchSymbols(substring: string): Promise<unknown>;
  getQuotes(userId: string, accountId: string, symbols: string[]): Promise<unknown>;

  // Broker — write
  previewTradeImpact(userId: string, accountId: string, options: TradeImpactOptions): Promise<unknown>;
  placeOrder(userId: string, accountId: string, order: PlaceOrderInput): Promise<OrderResult>;

  // Broker — connection management
  getConnectionUrl(userId: string, options: ConnectionUrlOptions): Promise<string | null>;
  removeConnection(userId: string, authorizationId: string): Promise<void>;
  ensureUserRegistered(userId: string): Promise<string | null>;
}
