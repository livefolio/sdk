import { describe, it, expect } from 'vitest';
import { applyTaxLossHarvesting } from './apply-tax-loss-harvest';
import type { Portfolio } from '../portfolio/types';
import type { TLHConfig } from './apply-tax-loss-harvest';
import type { AssetId } from '../interfaces/types';

// Helpers -------------------------------------------------------------------

/** Build a minimal Portfolio with a single tax lot. */
function makePortfolio(overrides?: {
  lotBasis?: number;
  lotQuantity?: number;
  assetId?: string;
}): Portfolio {
  const assetId = overrides?.assetId ?? 'US:SPY';
  return {
    cash: 0,
    positions: [],
    lots: [
      {
        id: 'lot-1',
        asset: { kind: 'equity', id: assetId as AssetId, symbol: assetId },
        quantity: overrides?.lotQuantity ?? 100,
        openDate: new Date('2025-01-01'),
        openPrice: overrides?.lotBasis !== undefined ? overrides.lotBasis / (overrides?.lotQuantity ?? 100) : 100,
        basis: overrides?.lotBasis ?? 10_000,
      },
    ],
    t: new Date('2025-01-01'),
  };
}

const BASE_CONFIG: TLHConfig = {
  enabled: true,
  minLossThreshold: 500,
  cooldownDays: 30,
  swapPairs: { 'US:SPY': 'US:IVV' },
};

// A portfolio with basis=10_000, quantity=100, price=85 → loss=1_500
const portfolio = makePortfolio({ lotBasis: 10_000, lotQuantity: 100 });
const prices = new Map<AssetId, number>([
  ['US:SPY' as AssetId, 85],
  ['US:IVV' as AssetId, 84],
]);
const baseWeights = new Map<AssetId, number>([
  ['US:SPY' as AssetId, 0.6],
  ['US:BND' as AssetId, 0.4],
]);
const asOf = new Date('2026-01-15');

// ---------------------------------------------------------------------------

describe('applyTaxLossHarvesting', () => {
  it('returns identity when enabled=false', () => {
    const config: TLHConfig = { ...BASE_CONFIG, enabled: false };
    const result = applyTaxLossHarvesting(baseWeights, portfolio, prices, asOf, config);
    expect(result.weights).toBe(baseWeights); // same reference
    expect(result.swaps).toEqual([]);
  });

  it('moves SPY weight to IVV when loss exceeds threshold', () => {
    const result = applyTaxLossHarvesting(baseWeights, portfolio, prices, asOf, BASE_CONFIG);
    // SPY should be removed
    expect(result.weights.has('US:SPY' as AssetId)).toBe(false);
    // IVV should get SPY's weight (IVV not in original, so sum = 0 + 0.6 = 0.6)
    expect(result.weights.get('US:IVV' as AssetId)).toBeCloseTo(0.6);
    // BND unchanged
    expect(result.weights.get('US:BND' as AssetId)).toBeCloseTo(0.4);
    // One swap recorded
    expect(result.swaps).toHaveLength(1);
    expect(result.swaps[0]).toEqual({
      from: 'US:SPY',
      to: 'US:IVV',
      expectedLoss: 1_500,
    });
  });

  it('does not swap when loss is below minLossThreshold', () => {
    const config: TLHConfig = { ...BASE_CONFIG, minLossThreshold: 5_000 };
    const result = applyTaxLossHarvesting(baseWeights, portfolio, prices, asOf, config);
    // Weights unchanged
    expect(result.weights.get('US:SPY' as AssetId)).toBeCloseTo(0.6);
    expect(result.swaps).toHaveLength(0);
  });

  it('does not swap when no swapPairs entry for the loss asset', () => {
    const config: TLHConfig = { ...BASE_CONFIG, swapPairs: {} };
    const result = applyTaxLossHarvesting(baseWeights, portfolio, prices, asOf, config);
    expect(result.weights.get('US:SPY' as AssetId)).toBeCloseTo(0.6);
    expect(result.swaps).toHaveLength(0);
  });

  it('blocks swap when a recent buy within cooldownDays exists', () => {
    const recentBuy = [{ assetId: 'US:SPY' as AssetId, t: new Date('2026-01-01') }]; // 14 days before asOf
    const result = applyTaxLossHarvesting(baseWeights, portfolio, prices, asOf, BASE_CONFIG, recentBuy);
    // Swap blocked due to wash-sale risk
    expect(result.weights.get('US:SPY' as AssetId)).toBeCloseTo(0.6);
    expect(result.swaps).toHaveLength(0);
  });

  it('does NOT block swap when the buy is older than cooldownDays', () => {
    // 31 days before asOf (2026-01-15) = 2025-12-15, which is outside 30-day window
    const oldBuy = [{ assetId: 'US:SPY' as AssetId, t: new Date('2025-12-15') }];
    const result = applyTaxLossHarvesting(baseWeights, portfolio, prices, asOf, BASE_CONFIG, oldBuy);
    // Swap should proceed
    expect(result.weights.has('US:SPY' as AssetId)).toBe(false);
    expect(result.swaps).toHaveLength(1);
  });

  it('skips assets with target weight <= 0', () => {
    const zeroWeights = new Map<AssetId, number>([
      ['US:SPY' as AssetId, 0],
      ['US:BND' as AssetId, 1.0],
    ]);
    const result = applyTaxLossHarvesting(zeroWeights, portfolio, prices, asOf, BASE_CONFIG);
    // SPY weight is 0 so skip despite loss above threshold
    expect(result.swaps).toHaveLength(0);
    // SPY entry present with 0 (not moved to IVV)
    expect(result.weights.get('US:SPY' as AssetId)).toBe(0);
  });

  it('lots without a price in prices map are skipped', () => {
    const pricesNoSPY = new Map<AssetId, number>([['US:IVV' as AssetId, 84]]);
    const result = applyTaxLossHarvesting(baseWeights, portfolio, pricesNoSPY, asOf, BASE_CONFIG);
    // No price for SPY → loss can't be computed → no swap
    expect(result.swaps).toHaveLength(0);
  });

  it('aggregates loss across multiple lots of the same asset', () => {
    const multiLotPortfolio: Portfolio = {
      cash: 0,
      positions: [],
      lots: [
        {
          id: 'lot-1',
          asset: { kind: 'equity', id: 'US:SPY' as AssetId, symbol: 'US:SPY' },
          quantity: 50,
          openDate: new Date('2025-01-01'),
          openPrice: 100,
          basis: 5_000, // loss = 5000 - 50*85 = 5000-4250 = 750
        },
        {
          id: 'lot-2',
          asset: { kind: 'equity', id: 'US:SPY' as AssetId, symbol: 'US:SPY' },
          quantity: 50,
          openDate: new Date('2025-02-01'),
          openPrice: 100,
          basis: 5_000, // loss = 5000 - 50*85 = 750
        },
      ],
      t: new Date('2025-01-01'),
    };
    // Total loss = 1_500 which is >= minLossThreshold 500
    const result = applyTaxLossHarvesting(baseWeights, multiLotPortfolio, prices, asOf, BASE_CONFIG);
    expect(result.swaps).toHaveLength(1);
    expect(result.swaps[0]?.expectedLoss).toBeCloseTo(1_500);
  });
});
