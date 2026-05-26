import { describe, it, expect } from 'vitest';
import { isQualifiedForLot, distributeDividend } from './dividends';
import type { Lot } from '../portfolio/types';
import type { DividendEvent } from '../interfaces/types';

const asset = { kind: 'equity' as const, id: 'AAPL', symbol: 'AAPL' };
const otherAsset = { kind: 'equity' as const, id: 'MSFT', symbol: 'MSFT' };

const exDate = new Date('2024-06-01');

function makeLot(overrides: Partial<Lot> = {}): Lot {
  return {
    id: 'lot-1',
    asset,
    quantity: 100,
    openDate: new Date('2024-01-01'),
    openPrice: 150,
    basis: 15_000,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<DividendEvent> = {}): DividendEvent {
  return {
    asset,
    exDate,
    payDate: new Date('2024-06-15'),
    amountPerShare: 0.5,
    incomeKind: 'qualified-eligible',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isQualifiedForLot
// ---------------------------------------------------------------------------
//
// The 121-day window is centred on exDate with half = floor(121/2) = 60, so
// windowStart = exDate − 60d = 2024-04-02. heldTo is capped at exDate, so the
// maximum days a lot can accumulate is 60. The default holdingDaysRequired is
// 60, so a lot held throughout the 60-day run-up qualifies (60 >= 60).

describe('isQualifiedForLot', () => {
  it('returns false for a short-held lot (~10d before exDate)', () => {
    // Lot opened 10 days before ex-date → only 10 days held in window (< 60)
    const lot = makeLot({ openDate: new Date('2024-05-22') }); // 10d before June 1
    expect(isQualifiedForLot(lot, exDate)).toBe(false);
  });

  it('returns true for a long-held lot (openDate well before windowStart)', () => {
    // Lot opened Jan 1 (before windowStart April 2) → heldFrom clamps to windowStart,
    // days = exDate − windowStart = 60 >= 60 default → true.
    const lot = makeLot({ openDate: new Date('2024-01-01') });
    expect(isQualifiedForLot(lot, exDate)).toBe(true);
  });

  it('returns true for a lot opened exactly on windowStart (exDate − 60d)', () => {
    // windowStart = 2024-04-02; heldFrom = April 2, heldTo = June 1, days = 60 >= 60 → true.
    const lot = makeLot({ openDate: new Date('2024-04-02') });
    expect(isQualifiedForLot(lot, exDate)).toBe(true);
  });

  it('returns false for a lot opened 1 day after windowStart (59 days in window)', () => {
    // Lot opened April 3 → days = June 1 − April 3 = 59 < 60 → false.
    const lot = makeLot({ openDate: new Date('2024-04-03') });
    expect(isQualifiedForLot(lot, exDate)).toBe(false);
  });

  it('honours a custom holdingDaysRequired override', () => {
    // Lot opened 30 days before exDate → 30 days in window.
    const lot = makeLot({ openDate: new Date('2024-05-02') }); // 30d before June 1
    expect(isQualifiedForLot(lot, exDate, { holdingDaysRequired: 30 })).toBe(true);
    expect(isQualifiedForLot(lot, exDate, { holdingDaysRequired: 31 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// distributeDividend
// ---------------------------------------------------------------------------

describe('distributeDividend', () => {
  it('ordinary incomeKind → all perLot qualified: false, totals.qualified === 0', () => {
    const event = makeEvent({ incomeKind: 'ordinary' });
    const lots = [
      makeLot({ id: 'lot-1', openDate: new Date('2024-01-01'), quantity: 100 }),
      makeLot({ id: 'lot-2', openDate: new Date('2024-01-01'), quantity: 200 }),
    ];
    const result = distributeDividend(event, lots);
    expect(result.totals.qualified).toBe(0);
    expect(result.perLot.every((pl) => !pl.qualified)).toBe(true);
    expect(result.perLot).toHaveLength(2);
  });

  it('interest incomeKind → all perLot qualified: false', () => {
    const event = makeEvent({ incomeKind: 'interest' });
    const lot = makeLot({ id: 'lot-1', openDate: new Date('2024-01-01'), quantity: 50 });
    const result = distributeDividend(event, [lot]);
    expect(result.totals.qualified).toBe(0);
    expect(result.perLot[0]?.qualified).toBe(false);
  });

  it('excludes a lot opened AFTER the ex-date', () => {
    const event = makeEvent();
    const afterLot = makeLot({ id: 'lot-after', openDate: new Date('2024-06-02') }); // after exDate
    const result = distributeDividend(event, [afterLot]);
    expect(result.perLot).toHaveLength(0);
    expect(result.totals.qualified).toBe(0);
    expect(result.totals.ordinary).toBe(0);
  });

  it('excludes a lot for a DIFFERENT asset', () => {
    const event = makeEvent();
    const wrongLot = makeLot({ id: 'lot-msft', asset: otherAsset });
    const result = distributeDividend(event, [wrongLot]);
    expect(result.perLot).toHaveLength(0);
  });

  it('excludes a lot with quantity <= 0', () => {
    const event = makeEvent();
    const zeroLot = makeLot({ id: 'lot-zero', quantity: 0 });
    const negLot = makeLot({ id: 'lot-neg', quantity: -5 });
    const result = distributeDividend(event, [zeroLot, negLot]);
    expect(result.perLot).toHaveLength(0);
  });

  it('mixed group under qualified-eligible (default opts): short → ordinary, long → qualified', () => {
    const event = makeEvent({ amountPerShare: 1.0, incomeKind: 'qualified-eligible' });
    // Short-held: opened May 22 (10d before exDate) → 10 days < 60 → ordinary
    const shortLot = makeLot({ id: 'short', openDate: new Date('2024-05-22'), quantity: 100 });
    // Long-held: opened Jan 1 (before windowStart) → 60 days >= 60 → qualified
    const longLot = makeLot({ id: 'long', openDate: new Date('2024-01-01'), quantity: 50 });

    const result = distributeDividend(event, [shortLot, longLot]);

    expect(result.perLot).toHaveLength(2);

    const shortEntry = result.perLot.find((pl) => pl.lotId === 'short')!;
    const longEntry = result.perLot.find((pl) => pl.lotId === 'long')!;

    // Cash = quantity * amountPerShare
    expect(shortEntry.cash).toBeCloseTo(100 * 1.0);
    expect(longEntry.cash).toBeCloseTo(50 * 1.0);

    expect(shortEntry.qualified).toBe(false);
    expect(longEntry.qualified).toBe(true);

    expect(result.totals.ordinary).toBeCloseTo(100); // short lot
    expect(result.totals.qualified).toBeCloseTo(50); // long lot
  });

  it('fully qualified scenario: totals.ordinary === 0', () => {
    const event = makeEvent({ amountPerShare: 2.0, incomeKind: 'qualified-eligible' });
    const lot = makeLot({ id: 'lot-q', openDate: new Date('2024-01-01'), quantity: 10 });
    const result = distributeDividend(event, [lot]);
    expect(result.totals.qualified).toBeCloseTo(20);
    expect(result.totals.ordinary).toBe(0);
    expect(result.perLot[0]?.qualified).toBe(true);
  });
});
