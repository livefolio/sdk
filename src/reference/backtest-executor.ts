import type { Executor } from '../interfaces/executor';
import type { Calendar } from '../interfaces/calendar';
import type { Asset } from '../interfaces/types';
import type { Order, Fill } from '../orders/types';
import type { Portfolio } from '../portfolio/types';

export type NextOpenFn = (asset: Asset, t: Date) => Promise<{ t: Date; price: number }>;

export type BacktestExecutorOptions = {
  calendar: Calendar;
  nextOpen: NextOpenFn;
  slippageBps?: number;
  perShareFee?: number;
};

function resolveAsset(order: Order, portfolio: Portfolio): { asset: Asset; sign: 1 | -1; qty: number } {
  switch (order.kind) {
    case 'open':
      return { asset: order.asset, sign: order.side === 'long' ? 1 : -1, qty: order.quantity };
    case 'rebalance':
      return { asset: order.asset, sign: order.delta >= 0 ? 1 : -1, qty: Math.abs(order.delta) };
    case 'close': {
      const p = portfolio.positions.find((x) => x.id === order.positionId);
      if (!p) throw new Error(`BacktestExecutor: close target position ${order.positionId} not found`);
      return { asset: p.asset, sign: p.side === 'long' ? -1 : 1, qty: order.quantity ?? p.quantity };
    }
    case 'adjust': {
      const p = portfolio.positions.find((x) => x.id === order.positionId);
      if (!p) throw new Error(`BacktestExecutor: adjust target position ${order.positionId} not found`);
      const target = order.changes.quantity ?? p.quantity;
      const delta = target - p.quantity;
      return { asset: p.asset, sign: delta >= 0 ? 1 : -1, qty: Math.abs(delta) };
    }
  }
}

export class BacktestExecutor implements Executor {
  constructor(private readonly opts: BacktestExecutorOptions) {}

  async submit(orders: ReadonlyArray<Order>, t: Date, portfolio: Portfolio): Promise<ReadonlyArray<Fill>> {
    const fills: Fill[] = [];
    const slip = (this.opts.slippageBps ?? 0) / 10_000;
    const feePer = this.opts.perShareFee ?? 0;

    for (const order of orders) {
      const { asset, sign, qty } = resolveAsset(order, portfolio);
      if (qty === 0) continue;
      const open = await this.opts.nextOpen(asset, t);
      const adjustedPrice = open.price * (1 + sign * slip);
      fills.push({
        orderRef: order.id,
        t: open.t,
        quantity: qty,
        price: adjustedPrice,
        fees: feePer * qty,
      });
    }
    return fills;
  }
}
