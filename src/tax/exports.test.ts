import { describe, it, expect } from 'vitest';
import * as sdk from '../index';
import { tax } from '../index';

describe('tax public exports', () => {
  it('exposes the flat tax functions on the package root', () => {
    for (const name of ['holdingPeriodDays', 'isLongTerm', 'realize', 'selectFIFO', 'selectLIFO', 'selectHIFO', 'selectMinTax', 'bucketByTerm', 'netWithinBucket', 'crossOffset', 'aggregateByYear', 'computeTaxBill'] as const) {
      expect(typeof (sdk as Record<string, unknown>)[name]).toBe('function');
    }
    expect(sdk.ORDINARY_OFFSET_CAP).toBe(3000);
  });
  it('exposes the tax namespace', () => {
    expect(typeof tax.computeTaxBill).toBe('function');
    expect(tax.ORDINARY_OFFSET_CAP).toBe(3000);
  });
});
