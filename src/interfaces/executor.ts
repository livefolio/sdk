import type { Order, Fill } from '../orders/types';
import type { Portfolio } from '../portfolio/types';

export interface Executor {
  submit(orders: ReadonlyArray<Order>, t: Date, portfolio: Portfolio): Promise<ReadonlyArray<Fill>>;
}
