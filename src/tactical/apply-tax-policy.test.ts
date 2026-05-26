import { describe, expect, it } from 'vitest';
import type { AssetId } from '../interfaces/types';
import type { Lot, Portfolio } from '../portfolio/types';
import type { PriceMap, TargetWeights } from '../strategy/reconcile';
import { applyTaxPolicy } from './apply-tax-policy';
import type { TaxPolicyConfig } from './apply-tax-policy';

const SPY = 'US:SPY' as AssetId;
const BND = 'US:BND' as AssetId;

function makeLot(id: AssetId, symbol: string, quantity: number): Lot {
  return {
    id: `lot-${symbol}`,
    asset: { kind: 'equity', id, symbol },
    quantity,
    openDate: new Date('2024-01-02'),
    openPrice: 100,
    basis: quantity * 100,
  };
}

/** Portfolio with SPY=60%, BND=40%, cash=$0 at $100/share */
function makePortfolio60_40(): Portfolio {
  return {
    cash: 0,
    positions: [],
    lots: [makeLot(SPY, 'SPY', 60), makeLot(BND, 'BND', 40)],
    t: new Date('2024-01-02'),
  };
}

const prices: PriceMap = new Map<AssetId, number>([
  [SPY, 100],
  [BND, 100],
]);

// Target: SPY=60%, BND=40% (current matches exactly)
const targetExact: TargetWeights = new Map<AssetId, number>([
  [SPY, 0.6],
  [BND, 0.4],
]);

// Target: SPY=70%, BND=30% (current drifts far from this)
const targetFar: TargetWeights = new Map<AssetId, number>([
  [SPY, 0.7],
  [BND, 0.3],
]);

const asOf = new Date('2024-01-02');

describe('applyTaxPolicy', () => {
  it('returns targetWeights unchanged when no config is provided', () => {
    const result = applyTaxPolicy(targetExact, makePortfolio60_40(), prices, asOf);
    expect(result).toBe(targetExact);
  });

  it('returns targetWeights unchanged for a non-taxable account (ira) even with driftBand', () => {
    const config: TaxPolicyConfig = {
      accountType: 'ira',
      shortTermRate: 0.37,
      longTermRate: 0.2,
      driftBand: { threshold: 0.05 },
    };
    const result = applyTaxPolicy(targetExact, makePortfolio60_40(), prices, asOf, config);
    expect(result).toBe(targetExact);
  });

  it('returns targetWeights unchanged for taxable account with no driftBand configured', () => {
    const config: TaxPolicyConfig = {
      accountType: 'taxable',
      shortTermRate: 0.37,
      longTermRate: 0.2,
    };
    const result = applyTaxPolicy(targetExact, makePortfolio60_40(), prices, asOf, config);
    expect(result).toBe(targetExact);
  });

  it('returns currentWeights (without _cash) when taxable + driftBand + portfolio WITHIN band', () => {
    // Portfolio: SPY=60%, BND=40% exactly; target: SPY=60%, BND=40%
    // Deviation = 0, well within band=0.05 → hold
    const config: TaxPolicyConfig = {
      accountType: 'taxable',
      shortTermRate: 0.37,
      longTermRate: 0.2,
      driftBand: { threshold: 0.05 },
    };
    const result = applyTaxPolicy(targetExact, makePortfolio60_40(), prices, asOf, config);

    // Should return current weights (not targetExact) — not the same reference
    expect(result).not.toBe(targetExact);
    // Should have SPY and BND weights matching current portfolio
    expect(result.get(SPY)).toBeCloseTo(0.6, 10);
    expect(result.get(BND)).toBeCloseTo(0.4, 10);
    // Must NOT contain _cash key
    expect(result.has('_cash' as AssetId)).toBe(false);
  });

  it('returns targetWeights unchanged when taxable + driftBand + portfolio OUTSIDE band', () => {
    // Portfolio: SPY=60%, BND=40%; target: SPY=70%, BND=30%
    // |0.60 - 0.70| = 0.10 >= band=0.05 → rebalance
    const config: TaxPolicyConfig = {
      accountType: 'taxable',
      shortTermRate: 0.37,
      longTermRate: 0.2,
      driftBand: { threshold: 0.05 },
    };
    const result = applyTaxPolicy(targetFar, makePortfolio60_40(), prices, asOf, config);
    expect(result).toBe(targetFar);
  });
});
