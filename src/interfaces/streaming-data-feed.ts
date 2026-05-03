import type { Asset, Bar } from './types';

/**
 * A single tick or bar update from a streaming market-data source. The bar's
 * `t` is the **arrival timestamp** of this tick — for a 24/7 source like Yahoo
 * WS, ticks arrive continuously and the runtime is responsible for deciding
 * which session/bar the tick belongs to via the `Calendar`.
 */
export type StreamingBar = {
  /** The asset this tick is for. */
  asset: Asset;
  /** The bar payload — typically a 1-tick OHLCV with `open = high = low = close = <tick price>` and `volume = 0`. */
  bar: Bar;
};

/**
 * Streaming market-data source. Sibling interface to {@link DataFeed} — they
 * are NOT a union. Historical adapters implement `DataFeed.bars()`; streaming
 * adapters implement `StreamingDataFeed.subscribe()`. A single vendor that
 * offers both (e.g. Polygon, Alpaca) implements both interfaces on one class.
 *
 * Implementations MUST guarantee:
 * - `subscribe` yields {@link StreamingBar} objects in **ascending `bar.t` order**
 *   per asset. Ordering across assets is not required.
 * - The iterable is **open-ended** — it does not terminate on its own. Consumers
 *   stop iteration by breaking the `for await` loop or by signalling cancel
 *   through whatever mechanism the runtime provides.
 * - Ticks may arrive **outside session hours** (24/7 sources like Yahoo WS).
 *   Session boundary logic is the runtime's responsibility, not the adapter's.
 *
 * @example
 * ```ts
 * import type { StreamingDataFeed, Asset } from '@livefolio/sdk';
 *
 * const feed: StreamingDataFeed = {
 *   async *subscribe(assets) {
 *     while (true) {
 *       const tick = await waitForNextTick();
 *       yield { asset: tick.asset, bar: tick.bar };
 *     }
 *   },
 * };
 * ```
 */
export interface StreamingDataFeed {
  /**
   * Subscribes to live tick updates for the given assets.
   *
   * **Frequency note:** This interface intentionally omits a `freq` parameter. Bar/tick aggregation
   * is the runtime's responsibility — see the `runLive` design in
   * `docs/specs/2026-05-02-v0.4-phase-9-streaming-design.md` Decision #1 (resolved during design).
   * Adapters emit raw ticks at whatever cadence the vendor provides; the runtime decides which
   * session/bar each tick belongs to via the `Calendar`. Multi-frequency streaming (sub-daily
   * strategies) is a separate phase, currently out of scope.
   *
   * @param assets - The instruments to subscribe to.
   * @returns An open-ended async iterable of {@link StreamingBar} updates.
   */
  subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar>;
}
