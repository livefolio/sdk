// ---------------------------------------------------------------------------
// SnapTrade operations interface
// Abstracts the SnapTrade SDK so we can swap in the real client later (PR #5).
// ---------------------------------------------------------------------------

export interface SnapTradeOperations {
  apiStatus: { check(): Promise<{ data: unknown }> };
  authentication: {
    registerSnapTradeUser(params: {
      userId: string;
    }): Promise<{ data: { userSecret?: string | null } }>;
    loginSnapTradeUser(params: {
      userId: string;
      userSecret: string;
      customRedirect: string;
      connectionType?: string;
    }): Promise<{ data: { redirectURI?: string | null } | Record<string, unknown> }>;
  };
  accountInformation: {
    listUserAccounts(params: {
      userId: string;
      userSecret: string;
    }): Promise<{ data: unknown[] }>;
    getUserHoldings(params: {
      accountId: string;
      userId: string;
      userSecret: string;
    }): Promise<{ data: unknown }>;
    getAccountActivities(
      params: Record<string, unknown>,
    ): Promise<{ data: unknown }>;
    getUserAccountRecentOrders(
      params: Record<string, unknown>,
    ): Promise<{ data: unknown }>;
    getUserAccountOrderDetail(
      params: Record<string, unknown>,
    ): Promise<{ data: unknown }>;
  };
  connections: {
    listBrokerageAuthorizations(params: {
      userId: string;
      userSecret: string;
    }): Promise<{ data: unknown[] }>;
    removeBrokerageAuthorization(params: {
      authorizationId: string;
      userId: string;
      userSecret: string;
    }): Promise<unknown>;
  };
  referenceData: {
    getSymbols(params: { substring: string }): Promise<{ data: unknown }>;
    symbolSearchUserAccount(
      params: Record<string, unknown>,
    ): Promise<{ data: unknown }>;
    listAllBrokerageInstruments(params: {
      slug: string;
    }): Promise<{ data: { instruments?: unknown[] } }>;
  };
  trading: {
    getUserAccountQuotes(
      params: Record<string, unknown>,
    ): Promise<{ data: unknown }>;
    getOrderImpact(params: Record<string, unknown>): Promise<{ data: unknown }>;
    placeForceOrder(
      params: Record<string, unknown>,
    ): Promise<{ data: { brokerage_order_id?: string | null } }>;
  };
}

// ---------------------------------------------------------------------------
// Domain types
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

export interface ConnectionUrlParams {
  customRedirect: string;
  connectionType?: 'read' | 'trade' | 'trade-if-available';
}

export interface ActivityOptions {
  startDate?: string;
  endDate?: string;
  offset?: number;
  limit?: number;
  type?: string;
}

export interface OrderOptions {
  onlyExecuted?: boolean;
}

export interface TradeImpactParams {
  action: 'BUY' | 'SELL';
  universalSymbolId: string;
  orderType: 'Limit' | 'Market' | 'StopLimit' | 'Stop';
  timeInForce: 'FOK' | 'Day' | 'GTC' | 'IOC';
  price?: number;
  stop?: number;
  units?: number;
  notionalValue?: number;
}

export interface PlaceOrderParams {
  action: 'BUY' | 'SELL';
  universalSymbolId: string;
  orderType: 'Limit' | 'Market' | 'StopLimit' | 'Stop';
  timeInForce: 'FOK' | 'Day' | 'GTC' | 'IOC';
  price?: number;
  stop?: number;
  units?: number;
  notionalValue?: number;
}

export interface OrderResult {
  brokerageOrderId: string | null;
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Module interface
// ---------------------------------------------------------------------------

export interface BrokerModule {
  getStatus(): Promise<unknown>;
  listConnections(): Promise<BrokerageConnection[]>;
  getConnectionUrl(params: ConnectionUrlParams): Promise<string | null>;
  removeConnection(authorizationId: string): Promise<void>;
  ensureUserRegistered(): Promise<string | null>;
  getHoldings(accountId: string): Promise<unknown>;
  listActivities(
    accountId: string,
    options?: ActivityOptions,
  ): Promise<unknown>;
  listRecentOrders(
    accountId: string,
    options?: OrderOptions,
  ): Promise<unknown>;
  getOrderDetail(
    accountId: string,
    brokerageOrderId: string,
  ): Promise<unknown>;
  getQuotes(accountId: string, symbols: string[]): Promise<unknown>;
  searchSymbols(substring: string, accountId?: string): Promise<unknown>;
  previewTradeImpact(
    accountId: string,
    params: TradeImpactParams,
  ): Promise<unknown>;
  placeOrder(accountId: string, order: PlaceOrderParams): Promise<OrderResult>;
  listInstruments(brokerageSlug: string): Promise<unknown[]>;
}
