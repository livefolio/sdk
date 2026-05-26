import { describe, it, expect } from 'vitest';
import { findWashSales, applyWashSaleAdjustment } from './wash-sale';
import type { Lot, RealizedEvent } from '../portfolio/types';

const SPY = { kind: 'equity', id: 'SPY', symbol: 'SPY' } as const;
const QQQ = { kind: 'equity', id: 'QQQ', symbol: 'QQQ' } as const;

const closeDate = new Date('2024-06-15');

function lossEvent(over: Partial<RealizedEvent> = {}): RealizedEvent {
  return {
    asset: SPY,
    lotId: 'sold',
    quantity: 100,
    openDate: new Date('2024-01-02'),
    closeDate,
    proceeds: 39_500,
    basis: 40_000,
    termType: 'short',
    gain: -500,
    incomeKind: 'capital-gain',
    ...over,
  };
}

function replacementLot(over: Partial<Lot> = {}): Lot {
  return {
    id: 'repl',
    asset: SPY,
    quantity: 100,
    openDate: new Date('2024-06-20'), // 5 days after closeDate → within window
    openPrice: 395,
    basis: 39_500,
    ...over,
  };
}

describe('findWashSales', () => {
  it('matches a same-asset replacement within ±30 days', () => {
    const adjs = findWashSales([lossEvent()], [replacementLot()]);
    expect(adjs).toEqual([{ lossEventLotId: 'sold', disallowedAmount: 500, replacementLotId: 'repl' }]);
  });

  it('does not match when the replacement is 31 days away', () => {
    const lot = replacementLot({ openDate: new Date(closeDate.getTime() + 31 * 86_400_000) });
    expect(findWashSales([lossEvent()], [lot])).toEqual([]);
  });

  it('ignores gain events (gain > 0)', () => {
    const gain = lossEvent({ gain: 500, proceeds: 40_500 });
    expect(findWashSales([gain], [replacementLot()])).toEqual([]);
  });

  it('ignores non-capital-gain income kinds', () => {
    const div = lossEvent({ incomeKind: 'ordinary-dividend' });
    expect(findWashSales([div], [replacementLot()])).toEqual([]);
  });

  it('ignores events already carrying washSaleDisallowed', () => {
    const marked = lossEvent({ washSaleDisallowed: 500 });
    expect(findWashSales([marked], [replacementLot()])).toEqual([]);
  });

  it('does not match a different-asset replacement lot', () => {
    expect(findWashSales([lossEvent()], [replacementLot({ id: 'q', asset: QQQ })])).toEqual([]);
  });

  it('does not treat the loss lot itself as its own replacement', () => {
    const sameId = replacementLot({ id: 'sold' });
    expect(findWashSales([lossEvent()], [sameId])).toEqual([]);
  });

  it('emits at most one adjustment per loss event', () => {
    const r1 = replacementLot({ id: 'r1', openDate: new Date('2024-06-18') });
    const r2 = replacementLot({ id: 'r2', openDate: new Date('2024-06-19') });
    const adjs = findWashSales([lossEvent()], [r1, r2]);
    expect(adjs).toHaveLength(1);
    expect(adjs[0]!.lossEventLotId).toBe('sold');
  });

  it('honors a custom windowDays', () => {
    const lot = replacementLot({ openDate: new Date(closeDate.getTime() + 5 * 86_400_000) });
    expect(findWashSales([lossEvent()], [lot], { windowDays: 3 })).toEqual([]);
    expect(findWashSales([lossEvent()], [lot], { windowDays: 10 })).toHaveLength(1);
  });
});

describe('applyWashSaleAdjustment', () => {
  it('bumps only the replacement lot basis and washSaleAdjustment', () => {
    const repl = replacementLot();
    const other: Lot = { ...replacementLot({ id: 'other' }), basis: 10_000 };
    const out = applyWashSaleAdjustment([repl, other], {
      lossEventLotId: 'sold',
      disallowedAmount: 500,
      replacementLotId: 'repl',
    });
    const bumped = out.find((l) => l.id === 'repl')!;
    const untouched = out.find((l) => l.id === 'other')!;
    expect(bumped.basis).toBe(40_000); // 39_500 + 500
    expect(bumped.washSaleAdjustment).toBe(500);
    expect(untouched.basis).toBe(10_000);
    expect(untouched.washSaleAdjustment).toBeUndefined();
  });

  it('accumulates into an existing washSaleAdjustment', () => {
    const repl = replacementLot({ washSaleAdjustment: 100, basis: 40_000 });
    const out = applyWashSaleAdjustment([repl], {
      lossEventLotId: 'sold',
      disallowedAmount: 500,
      replacementLotId: 'repl',
    });
    expect(out[0]!.basis).toBe(40_500);
    expect(out[0]!.washSaleAdjustment).toBe(600);
  });
});
