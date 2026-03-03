import { describe, expect, it } from 'vitest';
import { buildRebalancePlan, computePortfolioDriftPercentPoints } from './rebalance';

function mapOfNumber(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries);
}

describe('computePortfolioDriftPercentPoints', () => {
  it('computes half-sum absolute weight differences including cash', () => {
    const drift = computePortfolioDriftPercentPoints({
      targetWeights: mapOfNumber([
        ['SPY', 50],
        ['QQQ', 50],
      ]),
      currentValues: mapOfNumber([
        ['SPY', 300],
        ['QQQ', 700],
      ]),
      cashValue: 0,
      totalValue: 1000,
    });

    expect(drift).toBe(20);
  });

  it('does not double-count when strategy includes cash as explicit ticker (sum 100)', () => {
    const drift = computePortfolioDriftPercentPoints({
      targetWeights: mapOfNumber([
        ['SPY', 60],
        ['CASH', 40],
      ]),
      currentValues: mapOfNumber([
        ['SPY', 600],
        ['CASH', 400],
      ]),
      cashValue: 400,
      totalValue: 1000,
    });
    expect(drift).toBe(0);
  });
});

describe('buildRebalancePlan', () => {
  it('does not trigger when portfolio drift is below threshold', () => {
    const plan = buildRebalancePlan({
      targetWeights: mapOfNumber([
        ['SPY', 50],
        ['QQQ', 50],
      ]),
      currentValues: mapOfNumber([
        ['SPY', 300],
        ['QQQ', 700],
      ]),
      prices: mapOfNumber([
        ['SPY', 100],
        ['QQQ', 100],
      ]),
      cashValue: 0,
      totalValue: 1000,
      portfolioDriftThresholdPercentPoints: 25,
    });

    expect(plan.triggered).toBe(false);
    expect(plan.reason).toBe('below_threshold');
    expect(plan.orders).toEqual([]);
  });

  it('creates a funded plan with sells first then buys', () => {
    const plan = buildRebalancePlan({
      targetWeights: mapOfNumber([
        ['A', 25],
        ['B', 25],
        ['C', 25],
        ['D', 25],
      ]),
      currentValues: mapOfNumber([
        ['A', 0],
        ['B', 330],
        ['C', 330],
        ['D', 340],
      ]),
      prices: mapOfNumber([
        ['A', 10],
        ['B', 10],
        ['C', 10],
        ['D', 10],
      ]),
      cashValue: 0,
      totalValue: 1000,
      portfolioDriftThresholdPercentPoints: 25,
    });

    expect(plan.triggered).toBe(true);
    expect(plan.reason).toBe('ok');
    expect(plan.orders.filter((o) => o.action === 'SELL')).toHaveLength(3);
    expect(plan.orders.filter((o) => o.action === 'BUY')).toHaveLength(1);

    const sellValue = plan.orders
      .filter((o) => o.action === 'SELL')
      .reduce((sum, order) => sum + (order.estimatedValue ?? 0), 0);
    const buyValue = plan.orders
      .filter((o) => o.action === 'BUY')
      .reduce((sum, order) => sum + (order.estimatedValue ?? 0), 0);
    expect(buyValue).toBeLessThanOrEqual(sellValue + 1e-9);
  });

  it('does not create round-trip orders when holdings already match target weights', () => {
    const plan = buildRebalancePlan({
      targetWeights: mapOfNumber([
        ['SPY', 50],
        ['QQQ', 50],
      ]),
      currentValues: mapOfNumber([
        ['SPY', 500],
        ['QQQ', 500],
      ]),
      prices: mapOfNumber([
        ['SPY', 100],
        ['QQQ', 100],
      ]),
      cashValue: 0,
      totalValue: 1000,
      portfolioDriftThresholdPercentPoints: 0,
      cashReservePercent: 0,
      minCashReserveValue: 0,
      buySlippageBps: 0,
      sellSlippageBps: 0,
      perOrderFee: 0,
    });

    expect(plan.orders).toEqual([]);
    expect(plan.reason).toBe('no_orders');
  });

  it('creates only net delta trades for partially overlapping holdings', () => {
    const plan = buildRebalancePlan({
      targetWeights: mapOfNumber([
        ['SPY', 60],
        ['QQQ', 40],
      ]),
      currentValues: mapOfNumber([
        ['SPY', 700],
        ['QQQ', 300],
      ]),
      prices: mapOfNumber([
        ['SPY', 100],
        ['QQQ', 100],
      ]),
      cashValue: 0,
      totalValue: 1000,
      portfolioDriftThresholdPercentPoints: 0,
      cashReservePercent: 0,
      minCashReserveValue: 0,
      buySlippageBps: 0,
      sellSlippageBps: 0,
      perOrderFee: 0,
    });

    const sells = plan.orders.filter((o) => o.action === 'SELL');
    const buys = plan.orders.filter((o) => o.action === 'BUY');

    expect(sells).toHaveLength(1);
    expect(buys).toHaveLength(1);
    expect(sells[0]).toMatchObject({ action: 'SELL', symbol: 'SPY', quantity: 1, estimatedValue: 100 });
    expect(buys[0]).toMatchObject({ action: 'BUY', symbol: 'QQQ', quantity: 1, estimatedValue: 100 });

    expect(plan.orders.some((o) => o.action === 'BUY' && o.symbol === 'SPY')).toBe(false);
    expect(plan.orders.some((o) => o.action === 'SELL' && o.symbol === 'QQQ')).toBe(false);
  });

  it('uses execution buffer when sizing buys from cash', () => {
    const plan = buildRebalancePlan({
      targetWeights: mapOfNumber([['SPY', 100]]),
      currentValues: mapOfNumber([]),
      prices: mapOfNumber([['SPY', 100]]),
      cashValue: 1000,
      totalValue: 1000,
      portfolioDriftThresholdPercentPoints: 25,
    });

    expect(plan.triggered).toBe(true);
    expect(plan.reason).toBe('ok');
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]).toMatchObject({ action: 'BUY', symbol: 'SPY' });
    expect(plan.orders[0]?.quantity).toBeLessThan(10);
  });

  it('uses net sell proceeds (after sell slippage) to fund buys', () => {
    const plan = buildRebalancePlan({
      targetWeights: mapOfNumber([
        ['A', 0],
        ['B', 100],
      ]),
      currentValues: mapOfNumber([['A', 1000]]),
      prices: mapOfNumber([
        ['A', 100],
        ['B', 100],
      ]),
      cashValue: 0,
      totalValue: 1000,
      portfolioDriftThresholdPercentPoints: 25,
      minCashReserveValue: 0,
    });

    const sells = plan.orders.filter((o) => o.action === 'SELL');
    const buys = plan.orders.filter((o) => o.action === 'BUY');
    expect(sells).toHaveLength(1);
    expect(buys).toHaveLength(1);
    expect((buys[0]?.quantity ?? 0) * 100).toBeLessThan((sells[0]?.quantity ?? 0) * 100);
  });

  it('supports legacy behavior when all execution buffers are disabled', () => {
    const plan = buildRebalancePlan({
      targetWeights: mapOfNumber([['SPY', 100]]),
      currentValues: mapOfNumber([]),
      prices: mapOfNumber([['SPY', 100]]),
      cashValue: 1000,
      totalValue: 1000,
      portfolioDriftThresholdPercentPoints: 25,
      cashReservePercent: 0,
      minCashReserveValue: 0,
      buySlippageBps: 0,
      sellSlippageBps: 0,
      perOrderFee: 0,
    });

    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]).toMatchObject({ action: 'BUY', symbol: 'SPY', quantity: 10 });
  });

  it('respects per-symbol quantity precision overrides', () => {
    const plan = buildRebalancePlan({
      targetWeights: mapOfNumber([['SPY', 100]]),
      currentValues: mapOfNumber([]),
      prices: mapOfNumber([['SPY', 100]]),
      quantityPrecisionBySymbol: mapOfNumber([['SPY', 1]]),
      cashValue: 1000,
      totalValue: 1000,
      portfolioDriftThresholdPercentPoints: 25,
      cashReservePercent: 0,
      minCashReserveValue: 0,
      buySlippageBps: 0,
      sellSlippageBps: 0,
      perOrderFee: 0,
    });

    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]).toMatchObject({ action: 'BUY', symbol: 'SPY' });
    expect(Number.isInteger(plan.orders[0]?.quantity)).toBe(true);
  });

  it('throws when target symbol needs a trade but has no price', () => {
    expect(() =>
      buildRebalancePlan({
        targetWeights: mapOfNumber([
          ['SPY', 70],
          ['QQQ', 30],
        ]),
        currentValues: mapOfNumber([['SPY', 1000]]),
        prices: mapOfNumber([['SPY', 100]]),
        cashValue: 0,
        totalValue: 1000,
      }),
    ).toThrow('Invalid numeric value for price(QQQ)');
  });

  it('throws when target weights exceed 100', () => {
    expect(() =>
      buildRebalancePlan({
        targetWeights: mapOfNumber([
          ['SPY', 60],
          ['QQQ', 60],
        ]),
        currentValues: mapOfNumber([['SPY', 1000]]),
        prices: mapOfNumber([
          ['SPY', 100],
          ['QQQ', 100],
        ]),
        cashValue: 0,
        totalValue: 1000,
      }),
    ).toThrow('Invalid target weights: sum exceeds 100');
  });

  it('treats cash symbol as non-tradeable when cashSymbol is set', () => {
    const plan = buildRebalancePlan({
      targetWeights: mapOfNumber([
        ['SPY', 60],
        ['CASH', 40],
      ]),
      currentValues: mapOfNumber([
        ['SPY', 800],
        ['CASH', 200],
      ]),
      prices: mapOfNumber([['SPY', 100]]),
      cashValue: 200,
      totalValue: 1000,
      portfolioDriftThresholdPercentPoints: 10,
      cashSymbol: 'CASH',
    });
    expect(plan.triggered).toBe(true);
    expect(plan.orders.every((o) => o.symbol !== 'CASH')).toBe(true);
    expect(plan.orders.filter((o) => o.symbol === 'SPY' && o.action === 'SELL')).toHaveLength(1);
  });
});
