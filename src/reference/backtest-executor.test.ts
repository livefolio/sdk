import { describe, it, expect, vi } from 'vitest';
import { BacktestExecutor } from './backtest-executor';
import { NYSEExchangeCalendar } from '../calendars';
import type { Asset } from '../interfaces/types';
import type { Order } from '../orders/types';
import type { Portfolio, Position } from '../portfolio/types';

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };
const T = new Date('2026-01-02T00:00:00Z');
const NEXT = new Date('2026-01-05T00:00:00Z');

const portfolio: Portfolio = { cash: 10_000, positions: [], t: T };

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
});
