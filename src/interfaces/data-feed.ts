import type { Asset, Bar, DateRange, Frequency } from './types';

/**
 * A flat record of fundamental data points for an asset at a point in time.
 * Values may be numeric (e.g. P/E ratio), string (e.g. sector name), or
 * `null` when a data provider does not carry that field.
 *
 * @example
 * ```ts
 * import type { Fundamentals } from '@livefolio/sdk';
 *
 * const f: Fundamentals = {
 *   peRatio:    28.5,
 *   sector:     'Technology',
 *   debtEquity: null, // not available for this provider
 * };
 * ```
 */
export type Fundamentals = Readonly<Record<string, number | string | null>>;

/**
 * Categories of corporate events emitted by {@link DataFeed.events}.
 *
 * - `'earnings'`        — quarterly/annual earnings announcement
 * - `'dividend'`        — cash or stock dividend declaration
 * - `'split'`           — forward or reverse stock split
 * - `'corporate-action'`— catch-all for other actions (mergers, spin-offs, etc.)
 */
export type EventKind = 'earnings' | 'dividend' | 'split' | 'corporate-action';

/**
 * A single corporate event affecting an asset.
 *
 * The `payload` shape is event-kind-specific and defined by the data provider.
 * Callers should narrow on `kind` before reading `payload` fields.
 *
 * @example
 * ```ts
 * import type { DataEvent } from '@livefolio/sdk';
 *
 * const event: DataEvent = {
 *   kind:    'dividend',
 *   t:       new Date('2024-02-09'),
 *   asset:   { kind: 'equity', id: 'AAPL', symbol: 'AAPL' },
 *   payload: { amount: 0.24, currency: 'USD', exDate: '2024-02-09' },
 * };
 * ```
 */
export type DataEvent = {
  kind: EventKind;
  /** Effective date of the event (ex-date for dividends, announcement date for earnings). */
  t: Date;
  asset: Asset;
  /** Event-kind-specific fields. Shape is defined by the data provider. */
  payload: Readonly<Record<string, unknown>>;
};

/**
 * Market-data source. Provides price bars, fundamentals, and corporate events.
 *
 * Implementations MUST guarantee:
 * - `bars` yields {@link Bar} objects in **ascending `t` order**. Gaps (e.g.
 *   non-trading days) MUST be omitted rather than filled with synthetic bars.
 * - `bars` respects the half-open interval: the first bar's `t` is `>= range.from`
 *   and the last bar's `t` is `< range.to`.
 * - `fundamentals` (optional) returns a snapshot as of `t`; returning `undefined`
 *   is valid when no data is available.
 * - `events` (optional) yields events in ascending `t` order, filtered to the
 *   requested `kinds`.
 *
 * Reference implementations: use `vi.fn()` in tests or provide a typed mock
 * that returns pre-seeded bar arrays.
 *
 * @example
 * ```ts
 * import type { DataFeed, Asset, DateRange } from '@livefolio/sdk';
 * import { vi } from 'vitest';
 *
 * const feed: DataFeed = {
 *   bars: vi.fn().mockImplementation(async function* () {
 *     yield { t: new Date('2024-01-02'), open: 100, high: 102, low: 99, close: 101, volume: 1_000_000 };
 *   }),
 * };
 * ```
 */
export interface DataFeed {
  /**
   * Streams price bars for `asset` over the half-open interval
   * `[range.from, range.to)` at the requested `freq` granularity.
   *
   * Bars MUST be yielded in ascending `t` order. Non-trading periods MUST be
   * omitted (sparse output is expected and normal).
   *
   * @param asset - The instrument to fetch bars for.
   * @param range - Half-open date range; `range.from` inclusive, `range.to` exclusive.
   * @param freq  - Bar width. `'1d'` returns one bar per trading day.
   * @param kind  - `'adjusted'` (default) applies split/dividend adjustments;
   *   `'unadjusted'` returns raw prices. Indicators consume adjusted bars;
   *   execution fills and dividend cash-flow use unadjusted bars. Vendors that
   *   do not distinguish may ignore this and always return their single series.
   * @returns An async iterable of {@link Bar} objects.
   */
  bars(asset: Asset, range: DateRange, freq: Frequency, kind?: 'adjusted' | 'unadjusted'): AsyncIterable<Bar>;

  /**
   * Returns a snapshot of fundamental data for `asset` as of `t`.
   * Optional — not all data providers carry fundamentals.
   *
   * @param asset - The instrument to query.
   * @param t     - The point-in-time date for the snapshot.
   * @returns A flat record of fundamental values, or `undefined` if unavailable.
   */
  fundamentals?(asset: Asset, t: Date): Promise<Fundamentals>;

  /**
   * Streams corporate events within `range` filtered to the requested
   * `kinds`. Optional — providers that do not carry event data may omit this.
   *
   * Events MUST be yielded in ascending `t` order.
   *
   * @param range - Half-open date range.
   * @param kinds - Event categories to include.
   * @returns An async iterable of {@link DataEvent} objects.
   */
  events?(range: DateRange, kinds: ReadonlyArray<EventKind>): AsyncIterable<DataEvent>;
}
