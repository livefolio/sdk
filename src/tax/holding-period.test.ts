import { describe, it, expect } from 'vitest';
import { holdingPeriodDays, isLongTerm, realize } from './holding-period';
import type { Lot } from '../portfolio/types';

const lot: Lot = {
  id: 'L1',
  asset: { kind: 'equity', id: 'SPY', symbol: 'SPY' },
  quantity: 100,
  openDate: new Date('2024-01-15'),
  openPrice: 400,
  basis: 40_000,
};

describe('holding-period', () => {
  it('365 days is short-term, 366 is long-term', () => {
    expect(isLongTerm(365)).toBe(false);
    expect(isLongTerm(366)).toBe(true);
  });
  it('holdingPeriodDays returns float day count', () => {
    expect(holdingPeriodDays(lot, new Date('2024-01-25'))).toBeCloseTo(10);
  });
  it('realize partial sale pro-rates basis', () => {
    const r = realize(lot, 25, 500, new Date('2024-06-15'));
    expect(r.event.basis).toBeCloseTo(10_000);
    expect(r.event.proceeds).toBe(12_500);
    expect(r.event.gain).toBeCloseTo(2_500);
    expect(r.event.termType).toBe('short');
    expect(r.remainingLot!.quantity).toBe(75);
    expect(r.remainingLot!.basis).toBeCloseTo(30_000);
  });
  it('realize full sale yields no remainder and long-term past 1y', () => {
    const r = realize(lot, 100, 500, new Date('2025-06-15'));
    expect(r.remainingLot).toBeNull();
    expect(r.event.termType).toBe('long');
  });
  it('realize throws on oversell or non-positive qty', () => {
    expect(() => realize(lot, 101, 500, new Date('2024-06-15'))).toThrow(/cannot sell/);
    expect(() => realize(lot, 0, 500, new Date('2024-06-15'))).toThrow(/positive/);
  });
  it('realize classifies the 365/366-day boundary correctly end-to-end', () => {
    const open = new Date('2024-01-15T00:00:00Z');
    const lotB: Lot = { ...lot, openDate: open };
    const at365 = new Date(open.getTime() + 365 * 86_400_000);
    const at366 = new Date(open.getTime() + 366 * 86_400_000);
    expect(realize(lotB, 10, 500, at365).event.termType).toBe('short');
    expect(realize(lotB, 10, 500, at366).event.termType).toBe('long');
  });
});
