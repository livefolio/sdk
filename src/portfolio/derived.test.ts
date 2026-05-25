import { describe, it, expect } from 'vitest';
import { positionsByAsset } from './derived';
import type { Portfolio } from './types';

const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };

describe('positionsByAsset', () => {
  it('aggregates multiple lots of the same asset', () => {
    const p: Portfolio = {
      cash: 0, positions: [], realized: [], t: new Date('2024-06-01'),
      lots: [
        { id: 'l1', asset, quantity: 10, basis: 1000, openDate: new Date('2024-01-01'), openPrice: 100 },
        { id: 'l2', asset, quantity: 5, basis: 600, openDate: new Date('2024-06-01'), openPrice: 120 },
      ],
    };
    const pos = positionsByAsset(p);
    expect(pos).toHaveLength(1);
    expect(pos[0]!.quantity).toBe(15);
    expect(pos[0]!.basis).toBe(1600);
    expect(pos[0]!.side).toBe('long');
    expect(pos[0]!.entry.date).toEqual(new Date('2024-01-01')); // earliest
  });

  it('returns [] when lots are absent', () => {
    expect(positionsByAsset({ cash: 100, positions: [], t: new Date() })).toEqual([]);
  });
});
