import type { TypedSupabaseClient } from '../types';
import type {
  SnapTradeOperations,
  BrokerageConnection,
  BrokerageAccount,
  ConnectionUrlParams,
  ActivityOptions,
  OrderOptions,
  TradeImpactParams,
  PlaceOrderParams,
  OrderResult,
} from './types';
import { encryptSecret, decryptSecret } from './secret';

// ---------------------------------------------------------------------------
// Secret storage helpers
// ---------------------------------------------------------------------------

export async function getUserSecret(
  client: TypedSupabaseClient,
  userId: string,
  encryptionKey: string,
): Promise<string | null> {
  const { data, error } = await client
    .from('brokerage_connections')
    .select('user_secret_ciphertext')
    .eq('user_id', userId)
    .single();

  if (error || !data) return null;

  return decryptSecret(data.user_secret_ciphertext, encryptionKey);
}

export async function upsertUserSecret(
  client: TypedSupabaseClient,
  userId: string,
  userSecret: string,
  encryptionKey: string,
): Promise<void> {
  const ciphertext = encryptSecret(userSecret, encryptionKey);

  const { error } = await client.from('brokerage_connections').upsert(
    {
      user_id: userId,
      user_secret_ciphertext: ciphertext,
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    throw new Error(
      `Failed to upsert brokerage connection secret: ${error.message}`,
    );
  }
}

export async function requireUserSecret(
  client: TypedSupabaseClient,
  userId: string,
  encryptionKey: string,
): Promise<string> {
  const secret = await getUserSecret(client, userId, encryptionKey);
  if (!secret) {
    throw new Error('No brokerage connection secret found for user');
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export async function getStatus(
  snaptrade: SnapTradeOperations,
): Promise<unknown> {
  const res = await snaptrade.apiStatus.check();
  return res.data;
}

// ---------------------------------------------------------------------------
// User registration
// ---------------------------------------------------------------------------

export async function ensureUserRegistered(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
): Promise<string | null> {
  const existing = await getUserSecret(client, userId, encryptionKey);
  if (existing) return existing;

  let userSecret: string | null;
  try {
    const { data } = await snaptrade.authentication.registerSnapTradeUser({
      userId,
    });
    userSecret = data.userSecret ?? null;
  } catch {
    userSecret = null;
  }

  if (!userSecret) return null;

  try {
    await upsertUserSecret(client, userId, userSecret, encryptionKey);
  } catch {
    return null;
  }
  return userSecret;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export async function listConnections(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
): Promise<BrokerageConnection[]> {
  const userSecret = await requireUserSecret(client, userId, encryptionKey);
  return listConnectionsInternal(snaptrade, userId, userSecret);
}

async function listConnectionsInternal(
  snaptrade: SnapTradeOperations,
  userId: string,
  userSecret: string,
): Promise<BrokerageConnection[]> {
  const [accountsRes, authsRes] = await Promise.all([
    snaptrade.accountInformation.listUserAccounts({ userId, userSecret }),
    snaptrade.connections.listBrokerageAuthorizations({ userId, userSecret }),
  ]);

  const rawAccounts = accountsRes.data ?? [];
  const rawAuths = authsRes.data ?? [];

  const accountsByAuth = new Map<string, BrokerageAccount[]>();
  for (const acct of rawAccounts as Record<string, unknown>[]) {
    const total = (acct.balance as Record<string, unknown> | undefined)?.total as
      | Record<string, unknown>
      | undefined;
    const mapped: BrokerageAccount = {
      id: acct.id as string,
      name: (acct.name as string) ?? null,
      number: acct.number as string,
      institutionName: acct.institution_name as string,
      balance:
        total?.amount != null && total?.currency
          ? { amount: total.amount as number, currency: total.currency as string }
          : null,
      isPaper: acct.is_paper as boolean,
    };
    const authId = acct.brokerage_authorization as string;
    const list = accountsByAuth.get(authId) ?? [];
    list.push(mapped);
    accountsByAuth.set(authId, list);
  }

  return (rawAuths as Record<string, unknown>[]).map((auth) => {
    const brokerage = auth.brokerage as Record<string, unknown> | undefined;
    return {
      authorizationId: auth.id as string,
      brokerageName:
        (brokerage?.name as string) ??
        (auth.name as string) ??
        'Unknown',
      logoUrl: (brokerage?.aws_s3_square_logo_url as string) ?? null,
      disabled: (auth.disabled as boolean) ?? false,
      type: (auth.type as string) ?? null,
      accounts: accountsByAuth.get(auth.id as string) ?? [],
    };
  });
}

// ---------------------------------------------------------------------------
// Connection URL
// ---------------------------------------------------------------------------

export async function getConnectionUrl(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
  params: ConnectionUrlParams,
): Promise<string | null> {
  const userSecret = await requireUserSecret(client, userId, encryptionKey);
  const { data } = await snaptrade.authentication.loginSnapTradeUser({
    userId,
    userSecret,
    customRedirect: params.customRedirect,
    connectionType: params.connectionType ?? 'trade-if-available',
  });
  return 'redirectURI' in data ? ((data.redirectURI as string) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Remove connection
// ---------------------------------------------------------------------------

export async function removeConnection(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
  authorizationId: string,
): Promise<void> {
  const userSecret = await requireUserSecret(client, userId, encryptionKey);
  await snaptrade.connections.removeBrokerageAuthorization({
    authorizationId,
    userId,
    userSecret,
  });
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export async function getHoldings(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
  accountId: string,
): Promise<unknown> {
  const userSecret = await requireUserSecret(client, userId, encryptionKey);
  const res = await snaptrade.accountInformation.getUserHoldings({
    accountId,
    userId,
    userSecret,
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export async function listActivities(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
  accountId: string,
  options: ActivityOptions = {},
): Promise<unknown> {
  const userSecret = await requireUserSecret(client, userId, encryptionKey);
  const res = await snaptrade.accountInformation.getAccountActivities({
    accountId,
    userId,
    userSecret,
    startDate: options.startDate,
    endDate: options.endDate,
    offset: options.offset,
    limit: options.limit,
    type: options.type,
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// Recent orders
// ---------------------------------------------------------------------------

export async function listRecentOrders(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
  accountId: string,
  options: OrderOptions = {},
): Promise<unknown> {
  const userSecret = await requireUserSecret(client, userId, encryptionKey);
  const res = await snaptrade.accountInformation.getUserAccountRecentOrders({
    accountId,
    userId,
    userSecret,
    onlyExecuted: options.onlyExecuted,
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// Order detail
// ---------------------------------------------------------------------------

export async function getOrderDetail(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
  accountId: string,
  brokerageOrderId: string,
): Promise<unknown> {
  const userSecret = await requireUserSecret(client, userId, encryptionKey);
  const res = await snaptrade.accountInformation.getUserAccountOrderDetail({
    accountId,
    userId,
    userSecret,
    brokerage_order_id: brokerageOrderId,
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export async function getQuotes(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
  accountId: string,
  symbols: string[],
): Promise<unknown> {
  const userSecret = await requireUserSecret(client, userId, encryptionKey);
  const res = await snaptrade.trading.getUserAccountQuotes({
    userId,
    userSecret,
    accountId,
    symbols: symbols.join(','),
    useTicker: true,
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// Symbol search
// ---------------------------------------------------------------------------

export async function searchSymbols(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
  substring: string,
  accountId?: string,
): Promise<unknown> {
  if (accountId) {
    const userSecret = await requireUserSecret(client, userId, encryptionKey);
    const res = await snaptrade.referenceData.symbolSearchUserAccount({
      userId,
      userSecret,
      accountId,
      substring,
    });
    return res.data;
  }
  const res = await snaptrade.referenceData.getSymbols({ substring });
  return res.data;
}

// ---------------------------------------------------------------------------
// Trade impact preview
// ---------------------------------------------------------------------------

export async function previewTradeImpact(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
  accountId: string,
  params: TradeImpactParams,
): Promise<unknown> {
  const userSecret = await requireUserSecret(client, userId, encryptionKey);
  const res = await snaptrade.trading.getOrderImpact({
    userId,
    userSecret,
    account_id: accountId,
    action: params.action,
    universal_symbol_id: params.universalSymbolId,
    order_type: params.orderType,
    time_in_force: params.timeInForce,
    price: params.price ?? null,
    stop: params.stop ?? null,
    units: params.units ?? null,
    notional_value: params.notionalValue ?? null,
  });
  return res.data;
}

// ---------------------------------------------------------------------------
// Place order
// ---------------------------------------------------------------------------

export async function placeOrder(
  client: TypedSupabaseClient,
  snaptrade: SnapTradeOperations,
  userId: string,
  encryptionKey: string,
  accountId: string,
  order: PlaceOrderParams,
): Promise<OrderResult> {
  const userSecret = await requireUserSecret(client, userId, encryptionKey);
  const res = await snaptrade.trading.placeForceOrder({
    userId,
    userSecret,
    account_id: accountId,
    action: order.action,
    universal_symbol_id: order.universalSymbolId,
    order_type: order.orderType,
    time_in_force: order.timeInForce,
    price: order.price ?? null,
    stop: order.stop ?? null,
    units: order.units ?? null,
    notional_value: order.notionalValue ?? null,
  });
  return {
    brokerageOrderId: res.data.brokerage_order_id ?? null,
    raw: res.data,
  };
}

// ---------------------------------------------------------------------------
// List instruments
// ---------------------------------------------------------------------------

export async function listInstruments(
  snaptrade: SnapTradeOperations,
  brokerageSlug: string,
): Promise<unknown[]> {
  const res = await snaptrade.referenceData.listAllBrokerageInstruments({
    slug: brokerageSlug,
  });
  return res.data.instruments ?? [];
}
