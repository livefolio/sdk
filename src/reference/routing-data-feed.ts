import type { Asset, Bar, DateRange, DividendEvent, Frequency } from '../interfaces/types';
import type { DataFeed, Fundamentals } from '../interfaces/data-feed';

/**
 * Error thrown by {@link RoutingDataFeed} when an asset cannot be routed or
 * when the routed feed does not support the requested optional method.
 *
 * Distinguish the two cases via the message text: "no feed registered" vs
 * "does not implement `<method>`" (e.g. "does not implement fundamentals()" or
 * "does not implement dividends()").
 */
export class RoutingDataFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingDataFeedError';
  }
}

/** Function form of the routing rule. Returns the feed for `asset`, or `undefined` when no feed handles it. */
export type RoutingDataFeedRouteFn = (asset: Asset) => DataFeed | undefined;

/** Map form of the routing rule. Keys are `Asset['kind']` discriminants. */
export type RoutingDataFeedRouteMap = Readonly<Partial<Record<Asset['kind'], DataFeed>>>;

/**
 * A {@link DataFeed} that delegates each call to one of several underlying
 * feeds based on the asset. Use this to compose vendors — e.g. Yahoo for
 * equities and FRED for macro series — behind a single `DataFeed` instance
 * accepted by `runBacktest`, `FeatureRuntime`, and `BacktestExecutor`.
 *
 * Routing rules:
 * - **Map form:** `new RoutingDataFeed({ equity: yahoo, macro: fred })`.
 *   Keys are `asset.kind` discriminants. The 90% case.
 * - **Function form:** `new RoutingDataFeed((a) => a.kind === 'macro' ? fred : yahoo)`.
 *   Use when routing depends on more than `kind` (e.g. allowlists).
 *
 * `dividends()` and `fundamentals()` ARE implemented — each targets a single
 * asset, so it resolves to that asset's routed feed (or throws if the feed
 * lacks the method). The router does **not** implement `events()` — the
 * optional method is genuinely absent (`'events' in router === false`) because
 * cross-feed event fan-out is a separate, deferred problem.
 *
 * @example
 * ```ts
 * import { RoutingDataFeed } from '@livefolio/sdk';
 *
 * const feed = new RoutingDataFeed({ equity: yahooFeed, macro: fredFeed });
 *
 * const result = await runBacktest({
 *   strategy, range, initialPortfolio,
 *   dataFeed: feed,
 *   executor,
 *   calendar,
 * });
 * ```
 */
export class RoutingDataFeed implements DataFeed {
  private readonly route: RoutingDataFeedRouteFn;

  constructor(routes: RoutingDataFeedRouteMap | RoutingDataFeedRouteFn) {
    if (typeof routes === 'function') {
      this.route = routes;
    } else {
      this.route = (asset) => routes[asset.kind];
    }
  }

  // Async generator (rather than plain delegation) so resolve() runs lazily on
  // the first next() call, surfacing errors via the iterable's normal rejection
  // path instead of throwing synchronously at call time.
  async *bars(asset: Asset, range: DateRange, freq: Frequency, kind?: 'adjusted' | 'unadjusted'): AsyncGenerator<Bar> {
    const feed = this.resolve(asset);
    yield* feed.bars(asset, range, freq, kind);
  }

  async fundamentals(asset: Asset, t: Date): Promise<Fundamentals> {
    const feed = this.resolve(asset);
    if (typeof feed.fundamentals !== 'function') {
      throw new RoutingDataFeedError(
        `RoutingDataFeed: routed feed for asset.kind="${asset.kind}" (id="${asset.id}") does not implement fundamentals()`,
      );
    }
    return feed.fundamentals(asset, t);
  }

  async dividends(asset: Asset, range: DateRange): Promise<DividendEvent[]> {
    const feed = this.resolve(asset);
    if (typeof feed.dividends !== 'function') {
      throw new RoutingDataFeedError(
        `RoutingDataFeed: routed feed for asset.kind="${asset.kind}" (id="${asset.id}") does not implement dividends()`,
      );
    }
    return feed.dividends(asset, range);
  }

  private resolve(asset: Asset): DataFeed {
    const feed = this.route(asset);
    if (feed === undefined) {
      throw new RoutingDataFeedError(
        `RoutingDataFeed: no feed registered for asset.kind="${asset.kind}" (id="${asset.id}")`,
      );
    }
    return feed;
  }
}
