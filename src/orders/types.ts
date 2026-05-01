import type { Asset } from '../interfaces/types';

export type PositionId = string;

type OrderBase = { id: string };

export type OpenOrder = OrderBase & {
  kind: 'open';
  asset: Asset;
  side: 'long' | 'short';
  quantity: number;
  tag?: string;
};

export type CloseOrder = OrderBase & {
  kind: 'close';
  positionId: PositionId;
  quantity?: number;
};

export type AdjustOrder = OrderBase & {
  kind: 'adjust';
  positionId: PositionId;
  changes: { quantity?: number };
};

export type RebalanceOrder = OrderBase & {
  kind: 'rebalance';
  asset: Asset;
  delta: number;
};

export type Order = OpenOrder | CloseOrder | AdjustOrder | RebalanceOrder;

export type Fill = {
  orderRef: string;
  t: Date;
  quantity: number;
  price: number;
  fees: number;
};
