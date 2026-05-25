import { describe, it, expect } from 'vitest';
import { positionsByAsset } from './derived';
import type { Portfolio } from './types';

const asset = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };

describe('positionsByAsset', () => {
  it('aggregates multiple lots and uses the earliest lot for entry regardless of array order', () => {
    const p: Portfolio = {
      cash: 0,
      positions: [],
      realized: [],
      t: new Date('2024-06-01'),
      lots: [
        { id: 'l2', asset, quantity: 5, basis: 600, openDate: new Date('2024-06-01'), openPrice: 120 },
        { id: 'l1', asset, quantity: 10, basis: 1000, openDate: new Date('2024-01-01'), openPrice: 100 },
      ],
    };
    const pos = positionsByAsset(p);
    expect(pos).toHaveLength(1);
    expect(pos[0]!.quantity).toBe(15);
    expect(pos[0]!.basis).toBe(1600);
    expect(pos[0]!.side).toBe('long');
    expect(pos[0]!.entry.date).toEqual(new Date('2024-01-01')); // earliest by openDate, not array position
    expect(pos[0]!.entry.price).toBe(100); // earliest lot's openPrice
  });

  it('produces one position per distinct asset', () => {
    const spy = { kind: 'equity' as const, id: 'SPY', symbol: 'SPY' };
    const tlt = { kind: 'equity' as const, id: 'TLT', symbol: 'TLT' };
    const p: Portfolio = {
      cash: 0,
      positions: [],
      realized: [],
      t: new Date('2024-06-01'),
      lots: [
        { id: 'a', asset: spy, quantity: 10, basis: 1000, openDate: new Date('2024-01-01'), openPrice: 100 },
        { id: 'b', asset: tlt, quantity: 4, basis: 400, openDate: new Date('2024-02-01'), openPrice: 100 },
        { id: 'c', asset: spy, quantity: 5, basis: 600, openDate: new Date('2024-03-01'), openPrice: 120 },
      ],
    };
    const pos = positionsByAsset(p);
    expect(pos).toHaveLength(2);
    const bySym = Object.fromEntries(pos.map((x) => [x.asset.id, x]));
    expect(bySym.SPY!.quantity).toBe(15);
    expect(bySym.TLT!.quantity).toBe(4);
  });

  it('returns [] when lots are absent', () => {
    expect(positionsByAsset({ cash: 100, positions: [], t: new Date() })).toEqual([]);
  });
});
