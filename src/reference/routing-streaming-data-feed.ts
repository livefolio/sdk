import type { Asset } from '../interfaces/types';
import type { StreamingDataFeed, StreamingBar } from '../interfaces/streaming-data-feed';

/**
 * Error thrown by {@link RoutingStreamingDataFeed} when an asset cannot be routed.
 */
export class RoutingStreamingDataFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingStreamingDataFeedError';
  }
}

/** Function form of the routing rule. Returns the feed for `asset`, or `undefined` when no feed handles it. */
export type RoutingStreamingDataFeedRouteFn = (asset: Asset) => StreamingDataFeed | undefined;

/** Map form of the routing rule. Keys are `Asset['kind']` discriminants. */
export type RoutingStreamingDataFeedRouteMap = Readonly<Partial<Record<Asset['kind'], StreamingDataFeed>>>;

/**
 * A {@link StreamingDataFeed} that delegates `subscribe()` to one of several
 * underlying feeds based on the asset. Use this to compose vendors — e.g.
 * Polygon for equities and a polling adapter for macro series — behind a
 * single `StreamingDataFeed` instance accepted by `runLive`.
 *
 * Routing rules:
 * - **Map form:** `new RoutingStreamingDataFeed({ equity: polygon, macro: polling })`.
 *   Keys are `asset.kind` discriminants. The 90% case.
 * - **Function form:** `new RoutingStreamingDataFeed((a) => a.kind === 'macro' ? polling : polygon)`.
 *   Use when routing depends on more than `kind` (e.g. allowlists).
 *
 * Assets are grouped by routed feed (by reference identity) before calling
 * upstream `subscribe()` — so a vendor adapter that opens one socket for
 * `[AAPL, MSFT]` keeps doing that rather than receiving one-asset-at-a-time calls.
 *
 * @example
 * ```ts
 * import { RoutingStreamingDataFeed, pollingStreamFromHistorical } from '@livefolio/sdk';
 *
 * const feed = new RoutingStreamingDataFeed({
 *   equity: polygonStreaming,
 *   macro: pollingStreamFromHistorical({ feed: fredHistorical, freq: '1d', schedule: { kind: 'session-close', calendar: nyse } }),
 * });
 * ```
 */
export class RoutingStreamingDataFeed implements StreamingDataFeed {
  private readonly route: RoutingStreamingDataFeedRouteFn;

  constructor(routes: RoutingStreamingDataFeedRouteMap | RoutingStreamingDataFeedRouteFn) {
    if (typeof routes === 'function') {
      this.route = routes;
    } else {
      this.route = (asset) => routes[asset.kind];
    }
  }

  subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar> {
    return this.merged(assets);
  }

  // Async generator so routing/grouping errors surface on first next() rather
  // than throwing synchronously at subscribe() call time — matches RoutingDataFeed.bars() shape.
  private async *merged(assets: ReadonlyArray<Asset>): AsyncGenerator<StreamingBar> {
    if (assets.length === 0) return;

    const groups = new Map<StreamingDataFeed, Asset[]>();
    for (const asset of assets) {
      const feed = this.route(asset);
      if (feed === undefined) {
        throw new RoutingStreamingDataFeedError(
          `RoutingStreamingDataFeed: no feed registered for asset.kind="${asset.kind}" (id="${asset.id}")`,
        );
      }
      const list = groups.get(feed) ?? [];
      list.push(asset);
      groups.set(feed, list);
    }

    const iters = [...groups.entries()].map(([feed, group]) => feed.subscribe(group)[Symbol.asyncIterator]());
    yield* mergeIterators(iters);
  }
}

async function* mergeIterators(iters: ReadonlyArray<AsyncIterator<StreamingBar>>): AsyncGenerator<StreamingBar> {
  type Slot = {
    iter: AsyncIterator<StreamingBar>;
    promise: Promise<{ idx: number; r: IteratorResult<StreamingBar> }>;
  };
  const live = new Map<number, Slot>();

  const arm = (idx: number, iter: AsyncIterator<StreamingBar>): void => {
    live.set(idx, {
      iter,
      promise: iter.next().then((r) => ({ idx, r })),
    });
  };

  iters.forEach((iter, idx) => arm(idx, iter));

  try {
    while (live.size > 0) {
      const { idx, r } = await Promise.race([...live.values()].map((s) => s.promise));
      if (r.done) {
        live.delete(idx);
      } else {
        yield r.value;
        const slot = live.get(idx);
        if (slot) arm(idx, slot.iter);
      }
    }
  } finally {
    await Promise.allSettled(
      [...live.values()].map((s) => (s.iter.return ? s.iter.return(undefined) : Promise.resolve())),
    );
  }
}
