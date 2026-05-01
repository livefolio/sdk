import type { Asset } from '../interfaces/types';
import type { Portfolio } from '../portfolio/types';
import type { Order } from '../orders/types';

export type Features = Readonly<Record<string, unknown>>;

export interface Strategy<F extends Features = Features> {
  universe(t: Date, portfolio: Portfolio): ReadonlyArray<Asset>;
  features(universe: ReadonlyArray<Asset>, portfolio: Portfolio, t: Date): F | Promise<F>;
  build(features: F, portfolio: Portfolio, t: Date): ReadonlyArray<Order>;
}
