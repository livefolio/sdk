import { describe, it, expect, vi } from 'vitest';
import { BacktestExecutor } from './backtest-executor';
import { applyFills } from '../portfolio/apply';
import { NYSEExchangeCalendar } from '../calendars';
import type { Asset } from '../interfaces/types';
import type { Order } from '../orders/types';
import type { Portfolio, Position, Lot } from '../portfolio/types';

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };
const T = new Date('2026-01-02T00:00:00Z');
const NEXT = new Date('2026-01-05T00:00:00Z');

const portfolio: Portfolio = { cash: 10_000, positions: [], t: T };

// Two lots of SPY at different per-share basis. The cheaper lot was opened
// first; the pricier lot second. HIFO consumes the high-basis lot first.
const lotCheap: Lot = {
  id: 'lot_cheap',
  asset: SPY,
  quantity: 6,
  openDate: new Date('2025-06-01T00:00:00Z'),
  openPrice: 300,
  basis: 1800, // 300/share
};
const lotPricey: Lot = {
  id: 'lot_pricey',
  asset: SPY,
  quantity: 4,
  openDate: new Date('2025-09-01T00:00:00Z'),
  openPrice: 450,
  basis: 1800, // 450/share
};

describe('BacktestExecutor', () => {
  it('fills an OpenOrder at the next open with slippage and fees', async () => {
    const nextOpen = vi.fn(async () => ({ t: NEXT, price: 400 }));
    const exec = new BacktestExecutor({
      calendar: new NYSEExchangeCalendar(),
      nextOpen,
      slippageBps: 5,
      perShareFee: 0.01,
    });
    const order: Order = { id: 'o1', kind: 'open', asset: SPY, side: 'long', quantity: 10 };
    const fills = await exec.submit([order], T, portfolio);
    expect(fills).toHaveLength(1);
    expect(fills[0]!.orderRef).toBe('o1');
    expect(fills[0]!.t).toEqual(NEXT);
    expect(fills[0]!.quantity).toBe(10);
    expect(fills[0]!.price).toBeCloseTo(400 * (1 + 5 / 10_000), 8);
    expect(fills[0]!.fees).toBeCloseTo(0.01 * 10, 8);
  });

  it('fills a CloseOrder against a held long at next open minus slippage', async () => {
    const pos: Position = {
      id: 'p1',
      asset: SPY,
      side: 'long',
      quantity: 5,
      entry: { date: T, price: 380 },
      basis: 1900,
    };
    const held: Portfolio = { ...portfolio, positions: [pos] };
    const nextOpen = vi.fn(async () => ({ t: NEXT, price: 400 }));
    const exec = new BacktestExecutor({
      calendar: new NYSEExchangeCalendar(),
      nextOpen,
      slippageBps: 10,
    });
    const order: Order = { id: 'c1', kind: 'close', positionId: 'p1', quantity: 5 };
    const fills = await exec.submit([order], T, held);
    expect(fills[0]!.price).toBeCloseTo(400 * (1 - 10 / 10_000), 8);
  });

  it('throws when CloseOrder references an unknown position', async () => {
    const exec = new BacktestExecutor({
      calendar: new NYSEExchangeCalendar(),
      nextOpen: async () => ({ t: NEXT, price: 1 }),
    });
    const order: Order = { id: 'c1', kind: 'close', positionId: 'missing' };
    await expect(exec.submit([order], T, portfolio)).rejects.toThrow(/position/);
  });

  describe('lotMethod', () => {
    const cal = new NYSEExchangeCalendar();
    const nextOpen = () => Promise.resolve({ t: NEXT, price: 400 });

    it("constructor throws for lotMethod 'min-tax' without taxRates", () => {
      expect(() => new BacktestExecutor({ calendar: cal, nextOpen, lotMethod: 'min-tax' })).toThrow(/min-tax/);
    });

    it("constructor accepts lotMethod 'min-tax' with taxRates", () => {
      expect(
        () =>
          new BacktestExecutor({
            calendar: cal,
            nextOpen,
            lotMethod: 'min-tax',
            taxRates: { shortTerm: 0.37, longTerm: 0.2 },
          }),
      ).not.toThrow();
    });

    it('default/FIFO path emits a single fill with no lotId for a rebalance sell (parity-safe)', async () => {
      const held: Portfolio = { ...portfolio, lots: [lotCheap, lotPricey] };
      // Default (lotMethod unset)
      const execDefault = new BacktestExecutor({ calendar: cal, nextOpen });
      const order: Order = { id: 'r1', kind: 'rebalance', asset: SPY, delta: -5 };
      const fillsDefault = await execDefault.submit([order], T, held);
      expect(fillsDefault).toHaveLength(1);
      expect(fillsDefault[0]!.lotId).toBeUndefined();
      expect(fillsDefault[0]!.quantity).toBe(5);

      // Explicit 'FIFO' behaves identically
      const execFifo = new BacktestExecutor({ calendar: cal, nextOpen, lotMethod: 'FIFO' });
      const fillsFifo = await execFifo.submit([order], T, held);
      expect(fillsFifo).toHaveLength(1);
      expect(fillsFifo[0]!.lotId).toBeUndefined();
      expect(fillsFifo[0]!.quantity).toBe(5);
    });

    it('HIFO path splits a long rebalance sell into per-lot fills, highest-basis-first', async () => {
      const held: Portfolio = { ...portfolio, lots: [lotCheap, lotPricey] };
      const exec = new BacktestExecutor({ calendar: cal, nextOpen, lotMethod: 'HIFO', perShareFee: 0.01 });
      // Sell 7 shares: HIFO takes the 4 pricey shares first, then 3 cheap shares.
      const order: Order = { id: 'r2', kind: 'rebalance', asset: SPY, delta: -7 };
      const fills = await exec.submit([order], T, held);
      expect(fills).toHaveLength(2);
      expect(fills.map((f) => f.lotId)).toEqual(['lot_pricey', 'lot_cheap']);
      expect(fills.map((f) => f.quantity)).toEqual([4, 3]);
      expect(fills.reduce((s, f) => s + f.quantity, 0)).toBe(7);
      // Fees pro-rated per slice quantity; price consistent across slices.
      expect(fills[0]!.fees).toBeCloseTo(0.01 * 4, 8);
      expect(fills[1]!.fees).toBeCloseTo(0.01 * 3, 8);
      expect(fills[0]!.price).toBeCloseTo(fills[1]!.price, 8);
    });

    it('HIFO path splits a long close into per-lot fills', async () => {
      const pos: Position = {
        id: 'p1',
        asset: SPY,
        side: 'long',
        quantity: 10,
        entry: { date: T, price: 360 },
        basis: 3600,
      };
      const held: Portfolio = { ...portfolio, positions: [pos], lots: [lotCheap, lotPricey] };
      const exec = new BacktestExecutor({ calendar: cal, nextOpen, lotMethod: 'HIFO' });
      const order: Order = { id: 'c2', kind: 'close', positionId: 'p1', quantity: 10 };
      const fills = await exec.submit([order], T, held);
      expect(fills.map((f) => f.lotId)).toEqual(['lot_pricey', 'lot_cheap']);
      expect(fills.reduce((s, f) => s + f.quantity, 0)).toBe(10);
    });

    it('does NOT split a rebalance BUY under lotMethod HIFO', async () => {
      const held: Portfolio = { ...portfolio, lots: [lotCheap, lotPricey] };
      const exec = new BacktestExecutor({ calendar: cal, nextOpen, lotMethod: 'HIFO' });
      const order: Order = { id: 'r3', kind: 'rebalance', asset: SPY, delta: 5 };
      const fills = await exec.submit([order], T, held);
      expect(fills).toHaveLength(1);
      expect(fills[0]!.lotId).toBeUndefined();
      expect(fills[0]!.quantity).toBe(5);
    });

    it('does NOT split an adjust order under lotMethod HIFO', async () => {
      const pos: Position = {
        id: 'p1',
        asset: SPY,
        side: 'long',
        quantity: 10,
        entry: { date: T, price: 360 },
        basis: 3600,
      };
      const held: Portfolio = { ...portfolio, positions: [pos], lots: [lotCheap, lotPricey] };
      const exec = new BacktestExecutor({ calendar: cal, nextOpen, lotMethod: 'HIFO' });
      const order: Order = { id: 'a1', kind: 'adjust', positionId: 'p1', changes: { quantity: 6 } };
      const fills = await exec.submit([order], T, held);
      expect(fills).toHaveLength(1);
      expect(fills[0]!.lotId).toBeUndefined();
    });

    it('does NOT split a short-side close under lotMethod HIFO', async () => {
      const shortPos: Position = {
        id: 'ps',
        asset: SPY,
        side: 'short',
        quantity: 5,
        entry: { date: T, price: 400 },
        basis: 2000,
      };
      const held: Portfolio = { ...portfolio, positions: [shortPos] };
      const exec = new BacktestExecutor({ calendar: cal, nextOpen, lotMethod: 'HIFO' });
      const order: Order = { id: 'cs', kind: 'close', positionId: 'ps', quantity: 5 };
      const fills = await exec.submit([order], T, held);
      expect(fills).toHaveLength(1);
      expect(fills[0]!.lotId).toBeUndefined();
    });

    it('LIFO path splits a long rebalance sell newest-first', async () => {
      // lotCheap openDate 2025-06-01 (older), lotPricey 2025-09-01 (newer).
      const held: Portfolio = { ...portfolio, lots: [lotCheap, lotPricey] };
      const exec = new BacktestExecutor({ calendar: cal, nextOpen, lotMethod: 'LIFO' });
      // Sell 7: LIFO takes the 4 newest (pricey) shares first, then 3 from cheap.
      const order: Order = { id: 'r5', kind: 'rebalance', asset: SPY, delta: -7 };
      const fills = await exec.submit([order], T, held);
      expect(fills.map((f) => f.lotId)).toEqual(['lot_pricey', 'lot_cheap']);
      expect(fills.map((f) => f.quantity)).toEqual([4, 3]);
      expect(fills.reduce((s, f) => s + f.quantity, 0)).toBe(7);
    });

    it('min-tax path selects the long-term LOSS lot before the short-term GAIN lot', async () => {
      // asOf is NEXT (2026-01-05), sale price 400.
      // LT loss: opened > 365d before, basis/share 500 > 400 → tier 0 (selected first).
      const ltLoss: Lot = {
        id: 'lot_lt_loss',
        asset: SPY,
        quantity: 3,
        openDate: new Date('2024-06-01T00:00:00Z'),
        openPrice: 500,
        basis: 1500,
      };
      // ST gain: opened recently, basis/share 300 < 400 → tier 3 (selected last).
      const stGain: Lot = {
        id: 'lot_st_gain',
        asset: SPY,
        quantity: 5,
        openDate: new Date('2025-12-01T00:00:00Z'),
        openPrice: 300,
        basis: 1500,
      };
      const held: Portfolio = { ...portfolio, lots: [stGain, ltLoss] };
      const exec = new BacktestExecutor({
        calendar: cal,
        nextOpen,
        lotMethod: 'min-tax',
        taxRates: { shortTerm: 0.37, longTerm: 0.2 },
      });
      // Sell 5: 3 from the LT-loss lot first, then 2 from the ST-gain lot.
      const order: Order = { id: 'r6', kind: 'rebalance', asset: SPY, delta: -5 };
      const fills = await exec.submit([order], T, held);
      expect(fills.map((f) => f.lotId)).toEqual(['lot_lt_loss', 'lot_st_gain']);
      expect(fills.map((f) => f.quantity)).toEqual([3, 2]);
      expect(fills.reduce((s, f) => s + f.quantity, 0)).toBe(5);
    });

    it('falls back to a single fill (no lotId, no throw) for a stray reduce on an asset with no lots', async () => {
      // No SPY lots held; a rebalance reduce must not throw under a split method.
      const held: Portfolio = { ...portfolio, lots: [] };
      const exec = new BacktestExecutor({ calendar: cal, nextOpen, lotMethod: 'HIFO' });
      const order: Order = { id: 'r7', kind: 'rebalance', asset: SPY, delta: -5 };
      const fills = await exec.submit([order], T, held);
      expect(fills).toHaveLength(1);
      expect(fills[0]!.lotId).toBeUndefined();
      expect(fills[0]!.quantity).toBe(5);
    });

    it('end-to-end: split fills feed applyFills, realized events draw from HIFO lots', async () => {
      const pos: Position = {
        id: 'p1',
        asset: SPY,
        side: 'long',
        quantity: 10,
        entry: { date: T, price: 360 },
        basis: 3600,
      };
      const held: Portfolio = { ...portfolio, positions: [pos], lots: [lotCheap, lotPricey] };
      const exec = new BacktestExecutor({ calendar: cal, nextOpen, lotMethod: 'HIFO' });
      const order: Order = { id: 'r4', kind: 'rebalance', asset: SPY, delta: -7 };
      const fills = await exec.submit([order], T, held);
      const next = applyFills(held, fills, [order]);
      // Pricey lot fully consumed (4 shares), cheap lot reduced by 3 (6 -> 3).
      const remaining = (next.lots ?? []).filter((l) => l.quantity > 0);
      expect(remaining.map((l) => l.id)).toEqual(['lot_cheap']);
      expect(remaining[0]!.quantity).toBe(3);
      // Realized events: 4 shares from pricey lot, 3 from cheap lot.
      const realized = next.realized ?? [];
      expect(realized.map((r) => r.lotId).sort()).toEqual(['lot_cheap', 'lot_pricey']);
      const pricey = realized.find((r) => r.lotId === 'lot_pricey')!;
      const cheap = realized.find((r) => r.lotId === 'lot_cheap')!;
      expect(pricey.quantity).toBe(4);
      expect(cheap.quantity).toBe(3);
    });
  });
});
