import { describe, it, expect } from 'vitest';
import { selectFIFO, selectLIFO, selectHIFO, selectMinTax } from './lot-selection';
import type { Lot } from '../portfolio/types';

const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };

// l1: oldest, cheapest (basisPerShare=100)
// l2: mid-age, most expensive (basisPerShare=200)
// l3: newest, mid-price (basisPerShare=150)
const lots: Lot[] = [
  { id: 'l1', asset, quantity: 10, openDate: new Date('2023-01-01'), openPrice: 100, basis: 1000 },
  { id: 'l2', asset, quantity: 10, openDate: new Date('2023-06-01'), openPrice: 200, basis: 2000 },
  { id: 'l3', asset, quantity: 10, openDate: new Date('2024-11-01'), openPrice: 150, basis: 1500 },
];

describe('lot selectors', () => {
  // ── FIFO ────────────────────────────────────────────────────────────────────
  describe('selectFIFO', () => {
    it('takes oldest first', () => {
      expect(selectFIFO(lots, 15).map((s) => s.lotId)).toEqual(['l1', 'l2']);
    });

    it('slices sum to requested quantity', () => {
      expect(selectFIFO(lots, 15).reduce((s, x) => s + x.quantity, 0)).toBe(15);
    });

    it('partial lot at the boundary is sliced correctly', () => {
      const slices = selectFIFO(lots, 15);
      // l1 fully consumed (10), l2 partially (5)
      expect(slices[0]).toEqual({ lotId: 'l1', quantity: 10 });
      expect(slices[1]).toEqual({ lotId: 'l2', quantity: 5 });
    });

    it('exact full lot returns only that lot', () => {
      const slices = selectFIFO(lots, 10);
      expect(slices).toEqual([{ lotId: 'l1', quantity: 10 }]);
    });

    it('all three lots consumed when qty equals total', () => {
      expect(selectFIFO(lots, 30).map((s) => s.lotId)).toEqual(['l1', 'l2', 'l3']);
    });
  });

  // ── LIFO ────────────────────────────────────────────────────────────────────
  describe('selectLIFO', () => {
    it('takes newest first', () => {
      expect(selectLIFO(lots, 15).map((s) => s.lotId)).toEqual(['l3', 'l2']);
    });

    it('slices sum to requested quantity', () => {
      expect(selectLIFO(lots, 15).reduce((s, x) => s + x.quantity, 0)).toBe(15);
    });

    it('partial lot at the boundary is sliced correctly', () => {
      const slices = selectLIFO(lots, 15);
      expect(slices[0]).toEqual({ lotId: 'l3', quantity: 10 });
      expect(slices[1]).toEqual({ lotId: 'l2', quantity: 5 });
    });
  });

  // ── HIFO ────────────────────────────────────────────────────────────────────
  describe('selectHIFO', () => {
    it('takes highest per-share basis first (l2=200, l3=150, l1=100)', () => {
      expect(selectHIFO(lots, 15).map((s) => s.lotId)).toEqual(['l2', 'l3']);
    });

    it('slices sum to requested quantity', () => {
      expect(selectHIFO(lots, 15).reduce((s, x) => s + x.quantity, 0)).toBe(15);
    });

    it('partial lot at the boundary is sliced correctly', () => {
      const slices = selectHIFO(lots, 15);
      expect(slices[0]).toEqual({ lotId: 'l2', quantity: 10 });
      expect(slices[1]).toEqual({ lotId: 'l3', quantity: 5 });
    });
  });

  // ── selectMinTax ─────────────────────────────────────────────────────────────
  describe('selectMinTax', () => {
    // asOf = 2025-01-01
    // l1: openDate 2023-01-01 → 730 days → LT;  gainPerShare = 120-100 = +20  → tier 2 (LT gain)
    // l2: openDate 2023-06-01 → 579 days → LT;  gainPerShare = 120-200 = -80  → tier 0 (LT loss)
    // l3: openDate 2024-11-01 →  61 days → ST;  gainPerShare = 120-150 = -30  → tier 1 (ST loss)
    // Expected min-tax order: l2 (LT loss) → l3 (ST loss) → l1 (LT gain)

    const asOf = new Date('2025-01-01');
    const rates = { shortTerm: 0.37, longTerm: 0.2 };
    const price = 120;

    it('ranks LT loss before ST loss before LT gain', () => {
      const order = selectMinTax(lots, 30, { price, asOf, rates }).map((s) => s.lotId);
      expect(order).toEqual(['l2', 'l3', 'l1']);
    });

    it('first slice is the LT loss lot', () => {
      const order = selectMinTax(lots, 10, { price, asOf, rates }).map((s) => s.lotId);
      expect(order[0]).toBe('l2');
    });

    it('LT loss comes before ST loss when selling 20', () => {
      const order = selectMinTax(lots, 20, { price, asOf, rates }).map((s) => s.lotId);
      expect(order[0]).toBe('l2'); // LT loss first
      expect(order[1]).toBe('l3'); // ST loss second
    });

    it('slices sum to requested quantity', () => {
      expect(
        selectMinTax(lots, 20, { price, asOf, rates }).reduce((s, x) => s + x.quantity, 0),
      ).toBe(20);
    });

    it('within-tier ordering: smallest gain (biggest loss) first for LT losses', () => {
      // Two LT-loss lots: lotA gain=-80, lotB gain=-30 → lotA first (bigger loss = smaller gain)
      const lotsWithTwoLTLoss: Lot[] = [
        { id: 'lotA', asset, quantity: 5, openDate: new Date('2023-01-01'), openPrice: 200, basis: 1000 },
        { id: 'lotB', asset, quantity: 5, openDate: new Date('2023-03-01'), openPrice: 170, basis: 850 },
      ];
      // asOf 2025-01-01: both > 365 days → LT; price=120
      // lotA: gainPerShare = 120-200 = -80 → tier 0, smallest gain
      // lotB: gainPerShare = 120-170 = -50 → tier 0, larger gain than A
      const order = selectMinTax(lotsWithTwoLTLoss, 5, { price: 120, asOf, rates }).map((s) => s.lotId);
      expect(order[0]).toBe('lotA');
    });
  });

  // ── Cross-selector edge cases ────────────────────────────────────────────────
  describe('edge cases', () => {
    it('throws RangeError when insufficient quantity', () => {
      expect(() => selectFIFO(lots, 1000)).toThrow(/need|held/i);
      expect(() => selectLIFO(lots, 1000)).toThrow(RangeError);
      expect(() => selectHIFO(lots, 1000)).toThrow(RangeError);
      expect(() => selectMinTax(lots, 1000, { price: 120, asOf: new Date('2025-01-01'), rates: { shortTerm: 0.37, longTerm: 0.2 } })).toThrow(RangeError);
    });

    it('error message mentions need and held amounts', () => {
      expect(() => selectFIFO(lots, 1000)).toThrow(/need 1000/i);
    });

    it('skips zero-quantity lots (FIFO)', () => {
      const withZero: Lot[] = [{ ...lots[0]!, quantity: 0 }, lots[1]!];
      expect(selectFIFO(withZero, 5).map((s) => s.lotId)).toEqual(['l2']);
    });

    it('skips zero-quantity lots (LIFO)', () => {
      const withZero: Lot[] = [lots[0]!, { ...lots[1]!, quantity: 0 }, lots[2]!];
      expect(selectLIFO(withZero, 5).map((s) => s.lotId)).toEqual(['l3']);
    });

    it('skips zero-quantity lots (HIFO)', () => {
      const withZero: Lot[] = [{ ...lots[1]!, quantity: 0 }, lots[0]!];
      // l2 has qty=0 (skip), l1 has qty=10 (100/share)
      expect(selectHIFO(withZero, 5).map((s) => s.lotId)).toEqual(['l1']);
    });

    it('skips zero-quantity lots (selectMinTax)', () => {
      const withZero: Lot[] = [{ ...lots[0]!, quantity: 0 }, lots[1]!, lots[2]!];
      // l1 qty=0 → skipped; l2 LT loss, l3 ST loss → l2 first
      const order = selectMinTax(withZero, 5, {
        price: 120,
        asOf: new Date('2025-01-01'),
        rates: { shortTerm: 0.37, longTerm: 0.2 },
      }).map((s) => s.lotId);
      expect(order[0]).toBe('l2');
    });

    it('handles selling exactly one share from a multi-share lot', () => {
      const slices = selectFIFO(lots, 1);
      expect(slices).toEqual([{ lotId: 'l1', quantity: 1 }]);
    });
  });
});
