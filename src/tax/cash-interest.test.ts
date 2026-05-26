import { describe, it, expect } from 'vitest';
import { accrueCashInterest } from './cash-interest';

describe('accrueCashInterest', () => {
  it('computes interest and newCash for a single session', () => {
    const { interest, newCash } = accrueCashInterest(10_000, 0.0001);
    expect(interest).toBeCloseTo(1);
    expect(newCash).toBeCloseTo(10_001);
  });

  it('compounds over 365 sessions to approximately 5% APY', () => {
    let cash = 10_000;
    const dailyRate = 0.05 / 365;
    for (let i = 0; i < 365; i++) {
      const result = accrueCashInterest(cash, dailyRate);
      cash = result.newCash;
    }
    const totalAccrued = cash - 10_000;
    expect(totalAccrued).toBeGreaterThan(499);
    expect(totalAccrued).toBeLessThan(515);
  });

  it('returns zero interest and unchanged cash for zero rate', () => {
    const { interest, newCash } = accrueCashInterest(10_000, 0);
    expect(interest).toBe(0);
    expect(newCash).toBe(10_000);
  });
});
