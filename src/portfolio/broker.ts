import type { TypedSupabaseClient } from '../types';
import type { SnapTradeConfig } from '../types';
import type {
  BrokerageAccount,
  BrokerageConnection,
  Portfolio,
  OrderResult,
  ActivityOptions,
  TradeImpactOptions,
  PlaceOrderInput,
  ConnectionUrlOptions,
} from './types';
import { decryptUserSecret, encryptUserSecret } from './secret';
import { Snaptrade } from 'snaptrade-typescript-sdk';

// ---------------------------------------------------------------------------
// SnapTrade client factory
// ---------------------------------------------------------------------------

function createSnapTradeClient(config: SnapTradeConfig) {
  return new Snaptrade({
    clientId: config.clientId,
    consumerKey: config.consumerKey,
    ...(config.basePath ? { basePath: config.basePath } : {}),
  });
}

// ---------------------------------------------------------------------------
// User secret resolution
// ---------------------------------------------------------------------------

async function getUserSecret(
  supabase: TypedSupabaseClient,
  userId: string,
  encryptionKey: string,
): Promise<string> {
  const db = supabase as any;
  const { data, error } = await db
    .from('brokerage_connections')
    .select('user_secret_ciphertext')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to fetch user secret: ${error.message}`);
  if (!data?.user_secret_ciphertext) {
    throw new Error('No brokerage connection secret found for user');
  }

  return decryptUserSecret(data.user_secret_ciphertext, encryptionKey);
}

// ---------------------------------------------------------------------------
// Broker functions
// ---------------------------------------------------------------------------

export async function getConnections(
  supabase: TypedSupabaseClient,
  config: SnapTradeConfig,
  userId: string,
): Promise<BrokerageConnection[]> {
  const userSecret = await getUserSecret(supabase, userId, config.secretEncryptionKey);
  const client = createSnapTradeClient(config);

  const [accountsRes, authsRes] = await Promise.all([
    client.accountInformation.listUserAccounts({ userId, userSecret }),
    client.connections.listBrokerageAuthorizations({ userId, userSecret }),
  ]);

  const rawAccounts = accountsRes.data ?? [];
  const rawAuths = authsRes.data ?? [];

  const accountsByAuth = new Map<string, BrokerageAccount[]>();
  for (const acct of rawAccounts) {
    const total = acct.balance?.total;
    const mapped: BrokerageAccount = {
      id: acct.id,
      name: acct.name ?? null,
      number: acct.number,
      institutionName: acct.institution_name,
      balance: total?.amount != null && total?.currency ? { amount: total.amount, currency: total.currency } : null,
      isPaper: acct.is_paper,
    };
    const list = accountsByAuth.get(acct.brokerage_authorization) ?? [];
    list.push(mapped);
    accountsByAuth.set(acct.brokerage_authorization, list);
  }

  return rawAuths.map((auth: any) => ({
    authorizationId: auth.id!,
    brokerageName: auth.brokerage?.name ?? auth.name ?? 'Unknown',
    logoUrl: auth.brokerage?.aws_s3_square_logo_url ?? null,
    disabled: auth.disabled ?? false,
    type: auth.type ?? null,
    accounts: accountsByAuth.get(auth.id!) ?? [],
  }));
}

export async function getHoldings(
  supabase: TypedSupabaseClient,
  config: SnapTradeConfig,
  userId: string,
  accountId: string,
): Promise<Portfolio> {
  const userSecret = await getUserSecret(supabase, userId, config.secretEncryptionKey);
  const client = createSnapTradeClient(config);
  const res = await client.accountInformation.getUserHoldings({ accountId, userId, userSecret });
  const data = res.data;

  return {
    balancesByCurrency: (data.balances ?? []).map((b: any) => ({
      currency: b.currency?.code ?? null,
      cash: b.cash ?? null,
      buyingPower: b.buying_power ?? null,
    })),
    positions: (data.positions ?? []).map((p: any) => ({
      symbol: p.symbol?.symbol?.symbol ?? null,
      units: p.units ?? null,
      price: p.price ?? null,
      marketValue: p.units != null && p.price != null ? p.units * p.price : null,
    })),
  };
}

export async function getActivities(
  supabase: TypedSupabaseClient,
  config: SnapTradeConfig,
  userId: string,
  accountId: string,
  options?: ActivityOptions,
): Promise<unknown> {
  const userSecret = await getUserSecret(supabase, userId, config.secretEncryptionKey);
  const client = createSnapTradeClient(config);
  const res = await client.accountInformation.getAccountActivities({
    accountId,
    userId,
    userSecret,
    startDate: options?.startDate,
    endDate: options?.endDate,
    offset: options?.offset,
    limit: options?.limit,
    type: options?.type,
  });
  return res.data;
}

export async function getRecentOrders(
  supabase: TypedSupabaseClient,
  config: SnapTradeConfig,
  userId: string,
  accountId: string,
): Promise<unknown> {
  const userSecret = await getUserSecret(supabase, userId, config.secretEncryptionKey);
  const client = createSnapTradeClient(config);
  const res = await client.accountInformation.getUserAccountRecentOrders({
    accountId,
    userId,
    userSecret,
  });
  return res.data;
}

export async function searchSymbols(
  config: SnapTradeConfig,
  substring: string,
): Promise<unknown> {
  const client = createSnapTradeClient(config);
  const res = await client.referenceData.getSymbols({ substring });
  return res.data;
}

export async function getQuotes(
  supabase: TypedSupabaseClient,
  config: SnapTradeConfig,
  userId: string,
  accountId: string,
  symbols: string[],
): Promise<unknown> {
  const userSecret = await getUserSecret(supabase, userId, config.secretEncryptionKey);
  const client = createSnapTradeClient(config);
  const res = await client.trading.getUserAccountQuotes({
    userId,
    userSecret,
    accountId,
    symbols: symbols.join(','),
    useTicker: true,
  });
  return res.data;
}

export async function previewTradeImpact(
  supabase: TypedSupabaseClient,
  config: SnapTradeConfig,
  userId: string,
  accountId: string,
  options: TradeImpactOptions,
): Promise<unknown> {
  const userSecret = await getUserSecret(supabase, userId, config.secretEncryptionKey);
  const client = createSnapTradeClient(config);
  const res = await client.trading.getOrderImpact({
    userId,
    userSecret,
    account_id: accountId,
    action: options.action,
    universal_symbol_id: options.universalSymbolId,
    order_type: options.orderType,
    time_in_force: options.timeInForce,
    price: options.price ?? null,
    stop: options.stop ?? null,
    units: options.units ?? null,
    notional_value: options.notionalValue ?? null,
  });
  return res.data;
}

export async function placeOrder(
  supabase: TypedSupabaseClient,
  config: SnapTradeConfig,
  userId: string,
  accountId: string,
  order: PlaceOrderInput,
): Promise<OrderResult> {
  const userSecret = await getUserSecret(supabase, userId, config.secretEncryptionKey);
  const client = createSnapTradeClient(config);

  try {
    const res = await client.trading.placeForceOrder({
      userId,
      userSecret,
      account_id: accountId,
      action: order.action,
      symbol: order.symbol,
      order_type: order.orderType ?? 'Market',
      time_in_force: order.timeInForce ?? 'Day',
      units: order.units,
    });

    return {
      snaptradeOrderId: res.data.brokerage_order_id ?? undefined,
      snaptradeResponse: res.data,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Unknown error placing order',
    };
  }
}

export async function getConnectionUrl(
  supabase: TypedSupabaseClient,
  config: SnapTradeConfig,
  userId: string,
  options: ConnectionUrlOptions,
): Promise<string | null> {
  const userSecret = await getUserSecret(supabase, userId, config.secretEncryptionKey);
  const client = createSnapTradeClient(config);
  const { data } = await client.authentication.loginSnapTradeUser({
    userId,
    userSecret,
    customRedirect: options.customRedirect,
    connectionType: options.connectionType ?? 'trade-if-available',
  });
  return 'redirectURI' in data ? (data.redirectURI ?? null) : null;
}

export async function removeConnection(
  supabase: TypedSupabaseClient,
  config: SnapTradeConfig,
  userId: string,
  authorizationId: string,
): Promise<void> {
  const userSecret = await getUserSecret(supabase, userId, config.secretEncryptionKey);
  const client = createSnapTradeClient(config);
  await client.connections.removeBrokerageAuthorization({ authorizationId, userId, userSecret });
}

export async function ensureUserRegistered(
  supabase: TypedSupabaseClient,
  config: SnapTradeConfig,
  userId: string,
): Promise<string | null> {
  // Check for existing secret
  const db = supabase as any;
  const { data: existing } = await db
    .from('brokerage_connections')
    .select('user_secret_ciphertext')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (existing?.user_secret_ciphertext) {
    return decryptUserSecret(existing.user_secret_ciphertext, config.secretEncryptionKey);
  }

  // Register with SnapTrade
  const client = createSnapTradeClient(config);
  let userSecret: string | null = null;
  try {
    const { data } = await client.authentication.registerSnapTradeUser({ userId });
    userSecret = data.userSecret ?? null;
  } catch {
    return null;
  }

  if (!userSecret) return null;

  // Store encrypted secret
  try {
    const ciphertext = encryptUserSecret(userSecret, config.secretEncryptionKey);
    await db
      .from('brokerage_connections')
      .upsert({ user_id: userId, user_secret_ciphertext: ciphertext }, { onConflict: 'user_id' });
  } catch {
    return null;
  }

  return userSecret;
}
