import type { Asset } from './types';

/**
 * A point-in-time quote for an asset. The `t` field is the vendor-stamped
 * quote time — callers should treat it as the staleness upper bound, not
 * "now". `price` is the last trade price, or the mid when the vendor only
 * exposes bid/ask. `bid` and `ask` surface Level 1 data when available.
 *
 * @example
 * ```ts
 * import type { Quote } from '@livefolio/sdk';
 *
 * const q: Quote = {
 *   asset:    { kind: 'equity', id: 'AAPL', symbol: 'AAPL' },
 *   t:        new Date('2024-06-03T13:30:00Z'),
 *   price:    195.12,
 *   bid:      195.11,
 *   ask:      195.13,
 *   currency: 'USD',
 * };
 * ```
 */
export type Quote = {
  asset: Asset;
  /** Vendor-stamped quote time. */
  t: Date;
  /** Last trade price, or mid if the vendor only exposes bid/ask. */
  price: number;
  /** Best bid, when the vendor exposes Level 1 data. */
  bid?: number;
  /** Best ask, when the vendor exposes Level 1 data. */
  ask?: number;
  /** Quote currency, when the vendor reports it. */
  currency?: string;
};

/**
 * One-shot current-price source. Sibling interface to {@link DataFeed} and
 * {@link StreamingDataFeed} — they are NOT a union and there is no
 * composition helper. Historical adapters implement `DataFeed.bars()`;
 * streaming adapters implement `StreamingDataFeed.subscribe()`; quote
 * adapters implement `QuoteFeed.quote()`. A vendor that offers all three
 * implements all three interfaces on one class.
 *
 * Implementations MUST guarantee:
 * - `quote` returns a freshly fetched {@link Quote} each call. Implementations
 *   MAY cache for a short TTL to coalesce bursts; cache behavior MUST be
 *   documented on the adapter.
 * - The returned `Quote.t` is the vendor's stamp, not the local clock.
 * - `quote` rejects with a typed error if the asset is unsupported or the
 *   vendor is unreachable. It MUST NOT silently return a stale or fabricated
 *   price.
 *
 * `quoteBatch` is optional. Vendors whose endpoints accept a symbol list
 * SHOULD implement it to avoid N-round-trip storms. Callers feature-detect:
 *
 * ```ts
 * const quotes = feed.quoteBatch
 *   ? await feed.quoteBatch(assets)
 *   : await Promise.all(assets.map((a) => feed.quote(a)));
 * ```
 *
 * When `quoteBatch` is implemented, the returned array MUST preserve request
 * order — `quotes[i]` corresponds to `assets[i]`.
 *
 * @example
 * ```ts
 * import type { QuoteFeed } from '@livefolio/sdk';
 *
 * const feed: QuoteFeed = {
 *   async quote(asset) {
 *     return { asset, t: new Date(), price: 195.12 };
 *   },
 * };
 * ```
 */
export interface QuoteFeed {
  /**
   * Returns a freshly fetched quote for `asset`.
   *
   * @param asset - The instrument to quote.
   * @returns A {@link Quote} carrying the vendor-stamped time and price.
   */
  quote(asset: Asset): Promise<Quote>;

  /**
   * Returns quotes for `assets` in a single vendor round-trip. Optional —
   * adapters whose vendor does not expose a batch endpoint may omit this.
   *
   * Returned array MUST preserve request order: `result[i]` corresponds to
   * `assets[i]`.
   *
   * @param assets - The instruments to quote.
   * @returns An array of {@link Quote} objects in request order.
   */
  quoteBatch?(assets: ReadonlyArray<Asset>): Promise<ReadonlyArray<Quote>>;
}
