import type { Asset } from '../interfaces/types';

export type PositionId = string;

export type Position = {
  id: PositionId;
  asset: Asset;
  side: 'long' | 'short';
  quantity: number;
  entry: { date: Date; price: number };
  basis: number;
  tags?: Record<string, unknown>;
};

export type Portfolio = {
  cash: number;
  positions: ReadonlyArray<Position>;
  t: Date;
};
