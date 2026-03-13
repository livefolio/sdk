import type { BrokerOperations, PlaceOrderInput, OrderExecutionResult, StoredOrder } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BrokerOrderStatus = string | null | undefined;

function parseQuantity(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFilledOrderStatus(status: BrokerOrderStatus): boolean {
  return status === 'EXECUTED';
}

function isTerminalNonFilledStatus(status: BrokerOrderStatus): boolean {
  return (
    status === 'FAILED' ||
    status === 'REJECTED' ||
    status === 'CANCELED' ||
    status === 'EXPIRED' ||
    status === 'PARTIAL_CANCELED'
  );
}

async function waitForOrderFill(params: {
  broker: BrokerOperations;
  accountId: string;
  brokerageOrderId: string;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<{ finalStatus?: BrokerOrderStatus; lastOrderRecord?: unknown; timedOut: boolean }> {
  const { broker, accountId, brokerageOrderId, timeoutMs, pollIntervalMs } = params;

  const deadlineMs = Date.now() + timeoutMs;
  let lastOrderRecord: unknown;
  let lastStatus: BrokerOrderStatus;

  while (Date.now() < deadlineMs) {
    const record = await broker.getOrderDetail(accountId, brokerageOrderId);
    lastOrderRecord = record;
    lastStatus = record.status;

    const totalQuantity = parseQuantity(record.total_quantity);
    const openQuantity = parseQuantity(record.open_quantity);
    const filledQuantity = parseQuantity(record.filled_quantity);

    const quantitiesSuggestFilled =
      totalQuantity !== null &&
      openQuantity !== null &&
      filledQuantity !== null &&
      totalQuantity > 0 &&
      openQuantity <= 0 &&
      filledQuantity >= totalQuantity;

    if (isFilledOrderStatus(lastStatus) || quantitiesSuggestFilled) {
      return { finalStatus: lastStatus, lastOrderRecord, timedOut: false };
    }

    if (isTerminalNonFilledStatus(lastStatus)) {
      return { finalStatus: lastStatus, lastOrderRecord, timedOut: false };
    }

    await sleep(pollIntervalMs);
  }

  return { finalStatus: lastStatus, lastOrderRecord, timedOut: true };
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Execute a single trade order via the broker interface.
 */
export async function executeSingleOrder(
  broker: BrokerOperations,
  accountId: string,
  order: PlaceOrderInput,
): Promise<OrderExecutionResult> {
  try {
    const result = await broker.placeOrder(accountId, order);
    return {
      snaptradeOrderId: result.brokerageOrderId,
      snaptradeResponse: result.response,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : 'Unknown error placing order',
    };
  }
}

/**
 * Execute a batch of stored orders (sells first, then buys).
 * Returns per-order results keyed by order id.
 */
export async function executeTradeOrders(
  broker: BrokerOperations,
  accountId: string,
  orders: StoredOrder[],
  options?: {
    /** When true, blocks BUY submissions until all SELL orders are confirmed filled. Defaults to true. */
    waitForSellFills?: boolean;
    /** Max time to wait for SELL fills before skipping BUY submissions. */
    sellFillTimeoutMs?: number;
    /** Poll interval for order status checks. */
    sellFillPollIntervalMs?: number;
  },
): Promise<Map<number, OrderExecutionResult>> {
  const waitForSellFills = options?.waitForSellFills ?? true;
  const sellFillTimeoutMs = options?.sellFillTimeoutMs ?? 25_000;
  const sellFillPollIntervalMs = options?.sellFillPollIntervalMs ?? 1_000;

  const results = new Map<number, OrderExecutionResult>();

  const sells = orders.filter((o) => o.action === 'SELL');
  const buys = orders.filter((o) => o.action === 'BUY');

  // Execute sells first
  for (const order of sells) {
    const result = await executeSingleOrder(broker, accountId, {
      action: order.action,
      symbol: order.symbol,
      quantity: order.quantity,
    });
    results.set(order.id, result);
  }

  if (waitForSellFills && sells.length > 0) {
    // If any SELL placement failed, do not attempt BUYs
    const placementFailures = sells.filter((sell) => results.get(sell.id)?.error);
    const missingOrderIds = sells.filter((sell) => !results.get(sell.id)?.snaptradeOrderId);
    if (placementFailures.length > 0 || missingOrderIds.length > 0) {
      const reason =
        placementFailures.length > 0
          ? `SELL placement failed for ${placementFailures.length} order(s)`
          : `Missing brokerage_order_id for ${missingOrderIds.length} SELL order(s)`;
      for (const buy of buys) {
        results.set(buy.id, { error: `Skipped BUY: ${reason}` });
      }
      return results;
    }

    // Wait for all SELLs to fill before submitting BUYs
    const waitResults = await Promise.allSettled(
      sells.map(async (sell) => {
        const brokerageOrderId = results.get(sell.id)!.snaptradeOrderId!;
        const waitRes = await waitForOrderFill({
          broker,
          accountId,
          brokerageOrderId,
          timeoutMs: sellFillTimeoutMs,
          pollIntervalMs: sellFillPollIntervalMs,
        });
        return { sellId: sell.id, waitRes };
      }),
    );

    const rejected = waitResults.find((r) => r.status === 'rejected');
    if (rejected) {
      const message = rejected.reason instanceof Error ? rejected.reason.message : 'Unknown error polling order status';
      for (const buy of buys) {
        results.set(buy.id, { error: `Skipped BUY: error polling SELL fills (${message})` });
      }
      return results;
    }

    const fulfilled = waitResults
      .filter(
        (r): r is PromiseFulfilledResult<{ sellId: number; waitRes: Awaited<ReturnType<typeof waitForOrderFill>> }> =>
          r.status === 'fulfilled',
      )
      .map((r) => r.value);

    const anyTimedOut = fulfilled.some((r) => r.waitRes.timedOut);
    if (anyTimedOut) {
      for (const buy of buys) {
        results.set(buy.id, {
          error: `Skipped BUY: SELL orders not filled within ${Math.round(sellFillTimeoutMs / 1000)}s (retry later)`,
        });
      }
      return results;
    }

    const terminalNonFilled = fulfilled.find(
      (r) => isTerminalNonFilledStatus(r.waitRes.finalStatus) && !isFilledOrderStatus(r.waitRes.finalStatus),
    );
    if (terminalNonFilled) {
      const status = terminalNonFilled.waitRes.finalStatus ?? 'UNKNOWN';
      results.set(terminalNonFilled.sellId, {
        ...results.get(terminalNonFilled.sellId),
        snaptradeResponse: {
          placed: results.get(terminalNonFilled.sellId)?.snaptradeResponse,
          lastKnownOrder: terminalNonFilled.waitRes.lastOrderRecord,
        },
      });
      for (const buy of buys) {
        results.set(buy.id, { error: `Skipped BUY: SELL order not filled (status: ${status})` });
      }
      return results;
    }
  }

  // Execute buys
  for (const order of buys) {
    const result = await executeSingleOrder(broker, accountId, {
      action: order.action,
      symbol: order.symbol,
      quantity: order.quantity,
    });
    results.set(order.id, result);
  }

  return results;
}
