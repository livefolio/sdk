import type { Strategy, Features } from './types';
import type { Portfolio } from '../portfolio/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { Executor } from '../interfaces/executor';
import type { Calendar } from '../interfaces/calendar';
import type { FeatureCache } from '../interfaces/feature-cache';
import type { DateRange, Frequency } from '../interfaces/types';
import type { Order, Fill } from '../orders/types';
import { applyFills } from '../portfolio/apply';

export type RunBacktestOptions<F extends Features = Features> = {
  strategy: Strategy<F>;
  range: DateRange;
  initialPortfolio: Portfolio;
  dataFeed: DataFeed;
  executor: Executor;
  calendar: Calendar;
  featureCache?: FeatureCache;
  freq?: Frequency;
};

export type BacktestSnapshot = {
  t: Date;
  portfolio: Portfolio;
  orders: ReadonlyArray<Order>;
  fills: ReadonlyArray<Fill>;
};

export type BacktestResult = {
  snapshots: ReadonlyArray<BacktestSnapshot>;
  finalPortfolio: Portfolio;
};

export async function runBacktest<F extends Features = Features>(opts: RunBacktestOptions<F>): Promise<BacktestResult> {
  const sessions = opts.calendar.sessions(opts.range);
  if (sessions.length === 0) {
    return { snapshots: [], finalPortfolio: opts.initialPortfolio };
  }

  let portfolio = opts.initialPortfolio;
  const snapshots: BacktestSnapshot[] = [];

  for (const t of sessions) {
    const universe = opts.strategy.universe(t, portfolio);
    const features = await opts.strategy.features(universe, portfolio, t);
    const orders = opts.strategy.build(features, portfolio, t);
    const fills = await opts.executor.submit(orders, t, portfolio);
    portfolio = applyFills(portfolio, fills, orders);
    snapshots.push({ t, portfolio, orders, fills });
  }

  return { snapshots, finalPortfolio: portfolio };
}
