import type { Asset } from '../interfaces/types';
import type { Quote, QuoteFeed } from '../interfaces/quote-feed';

/**
 * Error thrown by {@link RoutingQuoteFeed} when an asset cannot be routed.
 */
export class RoutingQuoteFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingQuoteFeedError';
  }
}

/** Function form of the routing rule. Returns the feed for `asset`, or `undefined` when no feed handles it. */
export type RoutingQuoteFeedRouteFn = (asset: Asset) => QuoteFeed | undefined;

/** Map form of the routing rule. Keys are `Asset['kind']` discriminants. */
export type RoutingQuoteFeedRouteMap = Readonly<Partial<Record<Asset['kind'], QuoteFeed>>>;

/**
 * A {@link QuoteFeed} that delegates each call to one of several underlying
 * feeds based on the asset. Use this to compose vendors — e.g. Alpaca for
 * equity quotes and a polling adapter for macro series — behind a single
 * `QuoteFeed` instance.
 *
 * Routing rules:
 * - **Map form:** `new RoutingQuoteFeed({ equity: alpaca, macro: fredPolling })`.
 *   Keys are `asset.kind` discriminants. The 90% case.
 * - **Function form:** `new RoutingQuoteFeed((a) => a.kind === 'macro' ? fred : alpaca)`.
 *   Use when routing depends on more than `kind` (e.g. allowlists).
 *
 * The router always implements `quoteBatch` — even if some inner feeds lack
 * it, the router falls back to per-asset `quote()` calls within that group,
 * preserving request order across the full result.
 *
 * @example
 * ```ts
 * import { RoutingQuoteFeed } from '@livefolio/sdk';
 *
 * const feed = new RoutingQuoteFeed({ equity: alpacaQuotes, macro: fredQuotes });
 * const quotes = await feed.quoteBatch([aaplAsset, dgs10Asset, msftAsset]);
 * // quotes[0] is for AAPL, quotes[1] for DGS10, quotes[2] for MSFT — request order preserved.
 * ```
 */
export class RoutingQuoteFeed implements QuoteFeed {
  private readonly route: RoutingQuoteFeedRouteFn;

  constructor(routes: RoutingQuoteFeedRouteMap | RoutingQuoteFeedRouteFn) {
    if (typeof routes === 'function') {
      this.route = routes;
    } else {
      this.route = (asset) => routes[asset.kind];
    }
  }

  async quote(asset: Asset): Promise<Quote> {
    return this.resolve(asset).quote(asset);
  }

  async quoteBatch(assets: ReadonlyArray<Asset>): Promise<ReadonlyArray<Quote>> {
    if (assets.length === 0) return [];

    // Group by routed feed, tracking original index so we can re-collect in request order.
    // Resolve eagerly so unroutable assets throw before any vendor call.
    const groups = new Map<QuoteFeed, Array<{ asset: Asset; index: number }>>();
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i]!;
      const feed = this.resolve(asset);
      const bucket = groups.get(feed) ?? [];
      bucket.push({ asset, index: i });
      groups.set(feed, bucket);
    }

    const output = new Array<Quote>(assets.length);

    await Promise.all(
      [...groups.entries()].map(async ([feed, bucket]) => {
        const bucketAssets = bucket.map((b) => b.asset);
        const results =
          typeof feed.quoteBatch === 'function'
            ? await feed.quoteBatch(bucketAssets)
            : await Promise.all(bucketAssets.map((a) => feed.quote(a)));
        for (let i = 0; i < bucket.length; i++) {
          output[bucket[i]!.index] = results[i]!;
        }
      }),
    );

    return output;
  }

  private resolve(asset: Asset): QuoteFeed {
    const feed = this.route(asset);
    if (feed === undefined) {
      throw new RoutingQuoteFeedError(
        `RoutingQuoteFeed: no feed registered for asset.kind="${asset.kind}" (id="${asset.id}")`,
      );
    }
    return feed;
  }
}
