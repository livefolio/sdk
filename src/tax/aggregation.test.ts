import { describe, it, expect } from 'vitest';
import {
  bucketByTerm,
  netWithinBucket,
  crossOffset,
  aggregateByYear,
  computeTaxBill,
  ORDINARY_OFFSET_CAP,
  type TaxableIncome,
} from './aggregation';
import type { RealizedEvent, IncomeKind } from '../portfolio/types';

const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };

function ev(p: {
  gain: number;
  term?: 'short' | 'long';
  kind?: IncomeKind;
  proceeds?: number;
  close?: string;
}): RealizedEvent {
  return {
    asset,
    lotId: 'l',
    quantity: 1,
    openDate: new Date('2023-01-01'),
    closeDate: new Date(p.close ?? '2024-06-01'),
    proceeds: p.proceeds ?? Math.max(0, p.gain),
    basis: 0,
    termType: p.term ?? 'short',
    gain: p.gain,
    incomeKind: p.kind ?? 'capital-gain',
  };
}

const blank = (): TaxableIncome => ({
  shortTermGains: 0,
  shortTermLosses: 0,
  longTermGains: 0,
  longTermLosses: 0,
  qualifiedDividends: 0,
  ordinaryDividends: 0,
  interestIncome: 0,
});

// ---------------------------------------------------------------------------
// ORDINARY_OFFSET_CAP
// ---------------------------------------------------------------------------

describe('ORDINARY_OFFSET_CAP', () => {
  it('is 3000', () => {
    expect(ORDINARY_OFFSET_CAP).toBe(3000);
  });
});

// ---------------------------------------------------------------------------
// bucketByTerm
// ---------------------------------------------------------------------------

describe('bucketByTerm', () => {
  it('partitions capital-gain events by termType', () => {
    const st = ev({ gain: 100, term: 'short' });
    const lt = ev({ gain: 200, term: 'long' });
    const { short, long } = bucketByTerm([st, lt]);
    expect(short).toEqual([st]);
    expect(long).toEqual([lt]);
  });

  it('excludes qualified-dividend events', () => {
    const div = ev({ gain: 50, kind: 'qualified-dividend', proceeds: 50 });
    const { short, long } = bucketByTerm([div]);
    expect(short).toHaveLength(0);
    expect(long).toHaveLength(0);
  });

  it('excludes ordinary-dividend events', () => {
    const div = ev({ gain: 30, kind: 'ordinary-dividend', proceeds: 30 });
    const { short, long } = bucketByTerm([div]);
    expect(short).toHaveLength(0);
    expect(long).toHaveLength(0);
  });

  it('excludes interest events', () => {
    const interest = ev({ gain: 20, kind: 'interest', proceeds: 20 });
    const { short, long } = bucketByTerm([interest]);
    expect(short).toHaveLength(0);
    expect(long).toHaveLength(0);
  });

  it('handles empty input', () => {
    const { short, long } = bucketByTerm([]);
    expect(short).toHaveLength(0);
    expect(long).toHaveLength(0);
  });

  it('correctly routes multiple ST and LT capital-gain events', () => {
    const events = [
      ev({ gain: 100, term: 'short' }),
      ev({ gain: -50, term: 'long' }),
      ev({ gain: 200, term: 'long' }),
      ev({ gain: -30, term: 'short' }),
      ev({ gain: 10, kind: 'interest', proceeds: 10 }), // excluded
    ];
    const { short, long } = bucketByTerm(events);
    expect(short).toHaveLength(2);
    expect(long).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// netWithinBucket
// ---------------------------------------------------------------------------

describe('netWithinBucket', () => {
  it('sums gains and losses correctly', () => {
    const events = [
      ev({ gain: 500 }),
      ev({ gain: 300 }),
      ev({ gain: -200 }),
      ev({ gain: -100 }),
    ];
    const result = netWithinBucket(events);
    expect(result.gains).toBe(800);
    expect(result.losses).toBe(300); // positive magnitude
    expect(result.net).toBe(500);
  });

  it('handles all gains', () => {
    const events = [ev({ gain: 100 }), ev({ gain: 200 })];
    const result = netWithinBucket(events);
    expect(result.gains).toBe(300);
    expect(result.losses).toBe(0);
    expect(result.net).toBe(300);
  });

  it('handles all losses', () => {
    const events = [ev({ gain: -400 }), ev({ gain: -600 })];
    const result = netWithinBucket(events);
    expect(result.gains).toBe(0);
    expect(result.losses).toBe(1000); // positive magnitude
    expect(result.net).toBe(-1000);
  });

  it('handles empty bucket', () => {
    const result = netWithinBucket([]);
    expect(result.gains).toBe(0);
    expect(result.losses).toBe(0);
    expect(result.net).toBe(0);
  });

  it('treats zero-gain events as gains (not losses)', () => {
    const result = netWithinBucket([ev({ gain: 0 })]);
    expect(result.gains).toBe(0);
    expect(result.losses).toBe(0);
    expect(result.net).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// crossOffset
// ---------------------------------------------------------------------------

describe('crossOffset', () => {
  it('both positive: no offset, return unchanged', () => {
    const result = crossOffset(1000, 2000);
    expect(result).toEqual({ taxableShort: 1000, taxableLong: 2000, ordinaryOffset: 0, carryForward: 0 });
  });

  it('both zero: treated as non-negative, return unchanged', () => {
    const result = crossOffset(0, 0);
    expect(result).toEqual({ taxableShort: 0, taxableLong: 0, ordinaryOffset: 0, carryForward: 0 });
  });

  it('both negative (small loss): all goes to ordinaryOffset', () => {
    // Both negative, total loss = 1000, within cap
    const result = crossOffset(-400, -600);
    expect(result.taxableShort).toBe(0);
    expect(result.taxableLong).toBe(0);
    expect(result.ordinaryOffset).toBe(1000);
    expect(result.carryForward).toBe(0);
  });

  it('both negative (large loss): cap at $3000 ordinary, remainder carry-forward', () => {
    // ST=-2000, LT=-5000, total=7000
    const result = crossOffset(-2000, -5000);
    expect(result.taxableShort).toBe(0);
    expect(result.taxableLong).toBe(0);
    expect(result.ordinaryOffset).toBe(3000);
    expect(result.carryForward).toBe(4000);
  });

  it('both negative (exactly $3000 loss): fully absorbed by ordinary offset', () => {
    const result = crossOffset(-1000, -2000);
    expect(result.ordinaryOffset).toBe(3000);
    expect(result.carryForward).toBe(0);
  });

  it('ST loss vs LT gain (combined >= 0): residual stays in LT bucket', () => {
    // ST=-1000, LT=+3000, combined=2000 >=0; LT>0 so taxableLong=combined=2000
    const result = crossOffset(-1000, 3000);
    expect(result.taxableShort).toBe(0);
    expect(result.taxableLong).toBe(2000);
    expect(result.ordinaryOffset).toBe(0);
    expect(result.carryForward).toBe(0);
  });

  it('LT loss vs ST gain (combined >= 0): residual stays in ST bucket', () => {
    // ST=+5000, LT=-2000, combined=3000 >=0; ST>0 so taxableShort=3000
    const result = crossOffset(5000, -2000);
    expect(result.taxableShort).toBe(3000);
    expect(result.taxableLong).toBe(0);
    expect(result.ordinaryOffset).toBe(0);
    expect(result.carryForward).toBe(0);
  });

  it('opposite signs, combined == 0: both taxable become 0, no offset', () => {
    // ST=-1000, LT=+1000, combined=0
    const result = crossOffset(-1000, 1000);
    expect(result.taxableShort).toBe(0);
    expect(result.taxableLong).toBe(0);
    expect(result.ordinaryOffset).toBe(0);
    expect(result.carryForward).toBe(0);
  });

  it('opposite signs, combined < 0 (small): ordinaryOffset covers it all', () => {
    // ST=+500, LT=-2000, combined=-1500; loss=1500 < 3000 cap
    const result = crossOffset(500, -2000);
    expect(result.taxableShort).toBe(0);
    expect(result.taxableLong).toBe(0);
    expect(result.ordinaryOffset).toBe(1500);
    expect(result.carryForward).toBe(0);
  });

  it('opposite signs, combined < 0 (large): $3000 ordinaryOffset, rest carryForward', () => {
    // ST=+500, LT=-8000, combined=-7500; loss=7500
    const result = crossOffset(500, -8000);
    expect(result.taxableShort).toBe(0);
    expect(result.taxableLong).toBe(0);
    expect(result.ordinaryOffset).toBe(3000);
    expect(result.carryForward).toBe(4500);
  });

  it('ST gain vs LT loss, combined < 0 (large)', () => {
    // ST=+1000, LT=-10000, combined=-9000; loss=9000
    const result = crossOffset(1000, -10000);
    expect(result.taxableShort).toBe(0);
    expect(result.taxableLong).toBe(0);
    expect(result.ordinaryOffset).toBe(3000);
    expect(result.carryForward).toBe(6000);
  });
});

// ---------------------------------------------------------------------------
// aggregateByYear
// ---------------------------------------------------------------------------

describe('aggregateByYear', () => {
  it('returns empty map for empty events', () => {
    const result = aggregateByYear([]);
    expect(result.size).toBe(0);
  });

  it('groups events by UTC close year', () => {
    const e2023 = ev({ gain: 100, term: 'short', close: '2023-12-31' });
    const e2024 = ev({ gain: 200, term: 'long', close: '2024-01-01' });
    const result = aggregateByYear([e2023, e2024]);
    expect(result.size).toBe(2);
    expect(result.get(2023)).toBeDefined();
    expect(result.get(2024)).toBeDefined();
  });

  it('sums short-term gains and losses correctly', () => {
    const events = [
      ev({ gain: 500, term: 'short', close: '2024-06-01' }),
      ev({ gain: -200, term: 'short', close: '2024-09-01' }),
      ev({ gain: 100, term: 'short', close: '2024-11-01' }),
    ];
    const result = aggregateByYear(events);
    const y = result.get(2024)!;
    expect(y.shortTermGains).toBe(600);
    expect(y.shortTermLosses).toBe(200); // positive magnitude
    expect(y.longTermGains).toBe(0);
    expect(y.longTermLosses).toBe(0);
  });

  it('sums long-term gains and losses correctly', () => {
    const events = [
      ev({ gain: 1000, term: 'long', close: '2024-03-01' }),
      ev({ gain: -300, term: 'long', close: '2024-07-01' }),
    ];
    const result = aggregateByYear(events);
    const y = result.get(2024)!;
    expect(y.longTermGains).toBe(1000);
    expect(y.longTermLosses).toBe(300); // positive magnitude
    expect(y.shortTermGains).toBe(0);
  });

  it('buckets qualified-dividend into qualifiedDividends', () => {
    const div = ev({ gain: 50, kind: 'qualified-dividend', proceeds: 50, close: '2024-04-01' });
    const result = aggregateByYear([div]);
    const y = result.get(2024)!;
    expect(y.qualifiedDividends).toBe(50);
    expect(y.shortTermGains).toBe(0);
    expect(y.longTermGains).toBe(0);
  });

  it('buckets ordinary-dividend into ordinaryDividends', () => {
    const div = ev({ gain: 30, kind: 'ordinary-dividend', proceeds: 30, close: '2024-04-01' });
    const result = aggregateByYear([div]);
    const y = result.get(2024)!;
    expect(y.ordinaryDividends).toBe(30);
  });

  it('buckets interest into interestIncome', () => {
    const interest = ev({ gain: 20, kind: 'interest', proceeds: 20, close: '2024-04-01' });
    const result = aggregateByYear([interest]);
    const y = result.get(2024)!;
    expect(y.interestIncome).toBe(20);
  });

  it('aggregates all income kinds in the same year', () => {
    const events = [
      ev({ gain: 500, term: 'short', close: '2024-01-15' }),
      ev({ gain: -100, term: 'short', close: '2024-02-15' }),
      ev({ gain: 1000, term: 'long', close: '2024-03-15' }),
      ev({ gain: -200, term: 'long', close: '2024-04-15' }),
      ev({ gain: 80, kind: 'qualified-dividend', proceeds: 80, close: '2024-05-15' }),
      ev({ gain: 40, kind: 'ordinary-dividend', proceeds: 40, close: '2024-06-15' }),
      ev({ gain: 15, kind: 'interest', proceeds: 15, close: '2024-07-15' }),
    ];
    const result = aggregateByYear(events);
    expect(result.size).toBe(1);
    const y = result.get(2024)!;
    expect(y.shortTermGains).toBe(500);
    expect(y.shortTermLosses).toBe(100);
    expect(y.longTermGains).toBe(1000);
    expect(y.longTermLosses).toBe(200);
    expect(y.qualifiedDividends).toBe(80);
    expect(y.ordinaryDividends).toBe(40);
    expect(y.interestIncome).toBe(15);
  });

  it('events across two calendar years produce two separate entries', () => {
    const events = [
      ev({ gain: 100, term: 'short', close: '2023-06-01' }),
      ev({ gain: 200, term: 'long', close: '2024-06-01' }),
      ev({ gain: 50, kind: 'qualified-dividend', proceeds: 50, close: '2023-09-01' }),
      ev({ gain: 75, kind: 'ordinary-dividend', proceeds: 75, close: '2024-03-01' }),
      ev({ gain: 25, kind: 'interest', proceeds: 25, close: '2023-11-01' }),
    ];
    const result = aggregateByYear(events);
    expect(result.size).toBe(2);

    const y2023 = result.get(2023)!;
    expect(y2023.shortTermGains).toBe(100);
    expect(y2023.qualifiedDividends).toBe(50);
    expect(y2023.interestIncome).toBe(25);
    expect(y2023.longTermGains).toBe(0);

    const y2024 = result.get(2024)!;
    expect(y2024.longTermGains).toBe(200);
    expect(y2024.ordinaryDividends).toBe(75);
    expect(y2024.shortTermGains).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeTaxBill
// ---------------------------------------------------------------------------

const RATES = { shortTerm: 0.37, longTerm: 0.2 };

describe('computeTaxBill', () => {
  it('pure gains: (stGain)*shortTerm + (ltGain)*longTerm', () => {
    const income: TaxableIncome = {
      ...blank(),
      shortTermGains: 1000,
      longTermGains: 2000,
    };
    const result = computeTaxBill(income, RATES);
    expect(result.breakdown.ordinaryPortion).toBeCloseTo(1000 * 0.37);
    expect(result.breakdown.ltPortion).toBeCloseTo(2000 * 0.2);
    expect(result.total).toBeCloseTo(1000 * 0.37 + 2000 * 0.2);
    expect(result.breakdown.carryForward).toBe(0);
  });

  it('pure losses below cap: all goes to ordinary offset, total = 0', () => {
    const income: TaxableIncome = {
      ...blank(),
      shortTermLosses: 500,
      longTermLosses: 1000,
    };
    const result = computeTaxBill(income, RATES);
    expect(result.total).toBe(0);
    expect(result.breakdown.ordinaryPortion).toBe(0);
    expect(result.breakdown.ltPortion).toBe(0);
    expect(result.breakdown.carryForward).toBe(0);
  });

  it('net ST income with ordinary dividend and interest', () => {
    const income: TaxableIncome = {
      ...blank(),
      shortTermGains: 2000,
      ordinaryDividends: 500,
      interestIncome: 300,
    };
    const result = computeTaxBill(income, RATES);
    // taxableShort=2000 (no losses), ordinary = (2000+500+300)*0.37
    expect(result.breakdown.ordinaryPortion).toBeCloseTo((2000 + 500 + 300) * 0.37);
    expect(result.breakdown.ltPortion).toBe(0);
  });

  it('qualified dividends pool with LT gains', () => {
    const income: TaxableIncome = {
      ...blank(),
      longTermGains: 3000,
      qualifiedDividends: 1000,
    };
    const result = computeTaxBill(income, RATES);
    // taxableLong=3000, ltPortion = (3000+1000)*0.2
    expect(result.breakdown.ltPortion).toBeCloseTo((3000 + 1000) * 0.2);
    expect(result.breakdown.ordinaryPortion).toBe(0);
  });

  it('CRITICAL: LT losses do NOT offset qualified dividends', () => {
    // netShort=0, netLong=-10000
    // netShort(0) >= 0, netLong(-10000) < 0 → opposite-signs branch
    // combined = 0 + (-10000) = -10000 < 0 → net loss = 10000
    // ordinaryOffset = min(3000, 10000) = 3000, carryForward = 7000
    // taxableShort=0, taxableLong=0
    // ltPortion = (0 + 5000) * 0.2 = 1000 — qualifiedDividends NOT offset by capital losses
    // ordinaryPortion = 0
    const income: TaxableIncome = {
      ...blank(),
      longTermLosses: 10000,
      qualifiedDividends: 5000,
    };
    const result = computeTaxBill(income, { shortTerm: 0.37, longTerm: 0.2 });
    expect(result.breakdown.ordinaryPortion).toBe(0);
    expect(result.breakdown.ltPortion).toBeCloseTo(5000 * 0.2); // 1000
    expect(result.breakdown.carryForward).toBe(7000);
    expect(result.total).toBeCloseTo(1000);
  });

  it('ST loss offsets LT gain; residual in LT; qualifiedDividends added separately', () => {
    // ST=-500, LT=+2000, combined=1500≥0 → taxableLong=1500, taxableShort=0
    // ltPortion = (1500 + 300)*0.2
    const income: TaxableIncome = {
      ...blank(),
      shortTermLosses: 500,
      longTermGains: 2000,
      qualifiedDividends: 300,
    };
    const result = computeTaxBill(income, RATES);
    expect(result.breakdown.ordinaryPortion).toBeCloseTo(0);
    expect(result.breakdown.ltPortion).toBeCloseTo((1500 + 300) * 0.2);
    expect(result.breakdown.carryForward).toBe(0);
  });

  it('LT loss offsets ST gain; residual in ST', () => {
    // ST=+5000, LT=-2000, combined=3000≥0 → taxableShort=3000, taxableLong=0
    const income: TaxableIncome = {
      ...blank(),
      shortTermGains: 5000,
      longTermLosses: 2000,
    };
    const result = computeTaxBill(income, RATES);
    expect(result.breakdown.ordinaryPortion).toBeCloseTo(3000 * 0.37);
    expect(result.breakdown.ltPortion).toBe(0);
    expect(result.breakdown.carryForward).toBe(0);
  });

  it('opposite signs combined < 0: carryForward surfaced', () => {
    // ST=+500, LT=-8000, combined=-7500 → loss=7500 → ordinaryOffset=3000, carryForward=4500
    const income: TaxableIncome = {
      ...blank(),
      shortTermGains: 500,
      longTermLosses: 8000,
    };
    const result = computeTaxBill(income, RATES);
    expect(result.total).toBe(0);
    expect(result.breakdown.carryForward).toBe(4500);
  });

  it('zero income, zero rates: total is 0, carryForward is 0', () => {
    const result = computeTaxBill(blank(), { shortTerm: 0, longTerm: 0 });
    expect(result.total).toBe(0);
    expect(result.breakdown.carryForward).toBe(0);
  });
});
