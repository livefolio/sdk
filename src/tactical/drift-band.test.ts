import { describe, expect, it } from 'vitest';
import type { AssetId } from '../interfaces/types';
import type { Lot, Portfolio } from '../portfolio/types';
import { currentWeights, withinDriftBand } from './drift-band';

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

describe('currentWeights', () => {
  it('computes 60/40 two-asset portfolio weights with 0% cash', () => {
    // SPY: 60 shares @ $100 = $6000 (60%)
    // BND: 40 shares @ $100 = $4000 (40%)
    // cash: $0 (0%)
    // total = $10000
    const portfolio: Portfolio = {
      cash: 0,
      positions: [],
      lots: [makeLot(SPY, 'SPY', 60), makeLot(BND, 'BND', 40)],
      t: new Date('2024-01-02'),
    };
    const prices = new Map<AssetId, number>([
      [SPY, 100],
      [BND, 100],
    ]);
    const weights = currentWeights(portfolio, prices);

    expect(weights.get(SPY)).toBeCloseTo(0.6, 10);
    expect(weights.get(BND)).toBeCloseTo(0.4, 10);
    expect(weights.get('_cash' as AssetId)).toBeCloseTo(0, 10);
  });

  it('returns non-zero _cash weight when portfolio has leftover cash, and all weights sum to ~1', () => {
    // SPY: 50 shares @ $100 = $5000 (50%)
    // cash: $5000 (50%)
    // total = $10000
    const portfolio: Portfolio = {
      cash: 5000,
      positions: [],
      lots: [makeLot(SPY, 'SPY', 50)],
      t: new Date('2024-01-02'),
    };
    const prices = new Map<AssetId, number>([[SPY, 100]]);
    const weights = currentWeights(portfolio, prices);

    expect(weights.get('_cash' as AssetId)).toBeCloseTo(0.5, 10);
    expect(weights.get(SPY)).toBeCloseTo(0.5, 10);

    const total = Array.from(weights.values()).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('returns Map([[_cash, 1]]) when total <= 0 (empty lots, cash: 0)', () => {
    const portfolio: Portfolio = {
      cash: 0,
      positions: [],
      lots: [],
      t: new Date('2024-01-02'),
    };
    const prices = new Map<AssetId, number>();
    const weights = currentWeights(portfolio, prices);

    expect(weights.size).toBe(1);
    expect(weights.get('_cash' as AssetId)).toBe(1);
  });

  it('skips lots whose asset has no entry in prices', () => {
    // SPY has a price, BND does not — BND lot is skipped
    // SPY: 100 shares @ $100 = $10000 (100%)
    // cash: $0
    const portfolio: Portfolio = {
      cash: 0,
      positions: [],
      lots: [makeLot(SPY, 'SPY', 100), makeLot(BND, 'BND', 50)],
      t: new Date('2024-01-02'),
    };
    const prices = new Map<AssetId, number>([[SPY, 100]]);
    const weights = currentWeights(portfolio, prices);

    expect(weights.get(SPY)).toBeCloseTo(1, 10);
    expect(weights.has(BND)).toBe(false);
    expect(weights.get('_cash' as AssetId)).toBeCloseTo(0, 10);
  });
});

describe('withinDriftBand', () => {
  it('returns true when weights are within band', () => {
    // current: SPY=60.0001%, BND=39.9999%, _cash=0%
    // target: SPY=60%, BND=40% → targetCash=0%
    // max deviation ≈ 0.000001 << band 0.05
    const current = new Map<AssetId, number>([
      [SPY, 0.600001],
      [BND, 0.399999],
      ['_cash' as AssetId, 0],
    ]);
    const target = new Map<AssetId, number>([
      [SPY, 0.6],
      [BND, 0.4],
    ]);
    expect(withinDriftBand(current, target, 0.05)).toBe(true);
  });

  it('returns false when a weight is exactly at the band boundary (>= boundary → false)', () => {
    // current: SPY=65%, BND=35%, _cash=0%
    // target: SPY=60%, BND=40% → targetCash=0%
    // |0.65 - 0.60| = 0.05 >= band 0.05 → false
    const current = new Map<AssetId, number>([
      [SPY, 0.65],
      [BND, 0.35],
      ['_cash' as AssetId, 0],
    ]);
    const target = new Map<AssetId, number>([
      [SPY, 0.6],
      [BND, 0.4],
    ]);
    expect(withinDriftBand(current, target, 0.05)).toBe(false);
  });

  it('handles target with a cash residual correctly', () => {
    // target: SPY=50% → targetCash = max(0, 1 - 0.5) = 0.5
    // current: SPY=50%, _cash=50%
    // both match → true with band 0.01
    const current = new Map<AssetId, number>([
      [SPY, 0.5],
      ['_cash' as AssetId, 0.5],
    ]);
    const target = new Map<AssetId, number>([[SPY, 0.5]]);
    expect(withinDriftBand(current, target, 0.01)).toBe(true);
  });
});
