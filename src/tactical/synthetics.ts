import type { Asset, AssetId, Bar, DateRange, Frequency } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { StreamingDataFeed, StreamingBar } from '../interfaces/streaming-data-feed';
import type { SyntheticAsset } from './types';
import { resolveAssetRef } from './asset-ref';

const TRADING_DAYS_PER_YEAR = 252;

/**
 * Per-bar core of the synthesis formula. Shared by {@link withSynthetics}
 * (historical) and {@link withStreamingSynthetics} (live) so the two code
 * paths cannot drift.
 *
 * Returns the synthesized close given the previous underlying / synthetic
 * closes and the current underlying close. Cold start (either prev undefined)
 * returns `underlyingClose` so the first emitted bar anchors to the underlying.
 */
function nextSynthClose(opts: {
  prevSynthClose: number | undefined;
  prevUnderlyingClose: number | undefined;
  underlyingClose: number;
  leverage: number;
  expense: number | undefined;
}): number {
  const { prevSynthClose, prevUnderlyingClose, underlyingClose, leverage, expense } = opts;
  if (prevSynthClose === undefined || prevUnderlyingClose === undefined) {
    return underlyingClose;
  }
  const drag = (expense ?? 0) / TRADING_DAYS_PER_YEAR;
  const safe = Number.isFinite(prevUnderlyingClose) && prevUnderlyingClose !== 0;
  const r = safe ? (underlyingClose - prevUnderlyingClose) / prevUnderlyingClose : 0;
  return prevSynthClose * (1 + leverage * r) * (1 - drag);
}

async function* synthesize(
  underlyingBars: AsyncIterable<Bar>,
  leverage: number,
  expense: number | undefined,
): AsyncIterable<Bar> {
  let prevUnderlyingClose: number | undefined;
  let prevSynthClose: number | undefined;
  for await (const u of underlyingBars) {
    const close = nextSynthClose({
      prevSynthClose,
      prevUnderlyingClose,
      underlyingClose: u.close,
      leverage,
      expense,
    });
    yield {
      t: u.t,
      open: close,
      high: close,
      low: close,
      close,
      volume: u.volume,
    };
    prevUnderlyingClose = u.close;
    prevSynthClose = close;
  }
}

/**
 * Wraps a {@link DataFeed} so that requests for any asset whose `id` appears in
 * `synthetics` are intercepted and their bar stream is derived on-the-fly from
 * the corresponding `underlying` asset.
 *
 * The synthesized close price on each bar is computed as:
 * ```
 * close_t = close_{t-1} × (1 + leverage × underlyingReturn_t) × (1 − expense/252)
 * ```
 * The first bar in the stream uses the underlying close directly. OHLC fields
 * other than `close` are all set to the synthesized close (they are not
 * independently scaled); `volume` is passed through from the underlying bar.
 *
 * Non-synthetic assets are proxied transparently to the original `dataFeed`.
 * `fundamentals`, `events`, and `dividends` methods, if present, are forwarded unchanged.
 *
 * Throws at construction time if `synthetics` contains duplicate `id` values.
 *
 * @param dataFeed   - The real data feed to wrap.
 * @param synthetics - Synthetic asset definitions; typically `spec.synthetics ?? []`.
 * @returns A new {@link DataFeed} that intercepts synthetic asset ids.
 *
 * @example
 * ```ts
 * import { withSynthetics } from '@livefolio/sdk';
 * import type { SyntheticAsset } from '@livefolio/sdk';
 *
 * const leveraged: SyntheticAsset = {
 *   id: 'SPY_3X', symbol: 'SPY3X',
 *   underlying: { id: 'SPY', symbol: 'SPY' },
 *   leverage: 3,
 *   expense: 0.01,
 * };
 *
 * const feed = withSynthetics(realFeed, [leveraged]);
 * // Requesting bars for asset { id: 'SPY_3X', ... } now returns 3× leveraged returns.
 * ```
 */
export function withSynthetics(dataFeed: DataFeed, synthetics: ReadonlyArray<SyntheticAsset>): DataFeed {
  const byId = new Map<string, SyntheticAsset>();
  for (const s of synthetics) {
    if (byId.has(s.id)) {
      throw new Error(`withSynthetics: duplicate synthetic asset id "${s.id}"`);
    }
    byId.set(s.id, s);
  }

  const wrapped: DataFeed = {
    // `kind` ('adjusted' | 'unadjusted') is forwarded to the underlying feed
    // before synthesis so synthetic bars derive from the requested price series.
    bars(asset: Asset, range: DateRange, freq: Frequency, kind?: 'adjusted' | 'unadjusted'): AsyncIterable<Bar> {
      const synth = byId.get(asset.id);
      if (!synth) return dataFeed.bars(asset, range, freq, kind);
      const underlying = resolveAssetRef(synth.underlying);
      return synthesize(dataFeed.bars(underlying, range, freq, kind), synth.leverage, synth.expense);
    },
  };

  if (dataFeed.fundamentals) {
    wrapped.fundamentals = dataFeed.fundamentals.bind(dataFeed);
  }
  if (dataFeed.events) {
    wrapped.events = dataFeed.events.bind(dataFeed);
  }
  if (dataFeed.dividends) {
    wrapped.dividends = dataFeed.dividends.bind(dataFeed);
  }

  return wrapped;
}

/**
 * Options for {@link withStreamingSynthetics}.
 */
export interface WithStreamingSyntheticsOptions {
  /**
   * Last known close per asset id, used to seed `prevUnderlyingClose` and
   * `prevSynthClose` so the first live tick of a synthetic continues smoothly
   * from the end of its historical series.
   *
   * Build it from a {@link BacktestResult}:
   * ```ts
   * const seedLastCloses = new Map<AssetId, number>();
   * for (const [id, bars] of history.bars) {
   *   const last = bars.at(-1)?.close;
   *   if (last !== undefined) seedLastCloses.set(id, last);
   * }
   * ```
   *
   * Without seeding, the first synthesized tick lands on the underlying's
   * price and produces a visible jump in live preview.
   */
  seedLastCloses: ReadonlyMap<AssetId, number>;
}

/**
 * Streaming-feed counterpart to {@link withSynthetics}. Wraps a
 * {@link StreamingDataFeed} so that subscriptions for synthetic asset ids
 * resolve to upstream subscriptions on the underlying, with each underlying
 * tick re-emitted as a synthesized tick on the synthetic's id using the same
 * `(1 + leverage × r) × (1 − expense/252)` formula as the historical wrapper.
 *
 * Behavior:
 * - Non-synthetic ids in the `assets` argument pass through to the inner feed
 *   unchanged.
 * - Underlyings that aren't directly in `assets` but are needed by a synthetic
 *   are subscribed silently — only the synthesized ticks are yielded back to
 *   the caller for those.
 * - Underlyings that the caller _did_ ask for in `assets` are yielded both as
 *   the raw underlying tick and as the synthesized tick(s).
 *
 * Throws at construction time if `synthetics` contains duplicate `id` values.
 *
 * @example
 * ```ts
 * import { withStreamingSynthetics, runLive } from '@livefolio/sdk';
 *
 * const seedLastCloses = new Map<AssetId, number>();
 * for (const [id, bars] of history.bars) {
 *   const last = bars.at(-1)?.close;
 *   if (last !== undefined) seedLastCloses.set(id, last);
 * }
 *
 * const liveFeed = withStreamingSynthetics(rawStreamingFeed, spec.synthetics ?? [], {
 *   seedLastCloses,
 * });
 *
 * for await (const event of runLive({ strategy, history, dataFeed: liveFeed, executor, calendar })) {
 *   // …
 * }
 * ```
 */
export function withStreamingSynthetics(
  inner: StreamingDataFeed,
  synthetics: ReadonlyArray<SyntheticAsset>,
  opts: WithStreamingSyntheticsOptions,
): StreamingDataFeed {
  const synthById = new Map<AssetId, SyntheticAsset>();
  for (const s of synthetics) {
    if (synthById.has(s.id)) {
      throw new Error(`withStreamingSynthetics: duplicate synthetic asset id "${s.id}"`);
    }
    synthById.set(s.id, s);
  }

  return {
    async *subscribe(assets: ReadonlyArray<Asset>): AsyncIterable<StreamingBar> {
      const passthroughIds = new Set<AssetId>();
      const requestedSynths: SyntheticAsset[] = [];
      const upstream: Asset[] = [];
      const upstreamSeen = new Set<AssetId>();

      for (const a of assets) {
        const synth = synthById.get(a.id);
        if (synth) {
          requestedSynths.push(synth);
          if (!upstreamSeen.has(synth.underlying.id)) {
            upstreamSeen.add(synth.underlying.id);
            upstream.push(resolveAssetRef(synth.underlying));
          }
        } else {
          passthroughIds.add(a.id);
          if (!upstreamSeen.has(a.id)) {
            upstreamSeen.add(a.id);
            upstream.push(a);
          }
        }
      }

      type SynthState = {
        synth: SyntheticAsset;
        asset: Asset;
        prevUnderlyingClose: number | undefined;
        prevSynthClose: number | undefined;
      };
      const synthsByUnderlying = new Map<AssetId, SynthState[]>();
      for (const s of requestedSynths) {
        const st: SynthState = {
          synth: s,
          asset: resolveAssetRef({ id: s.id, symbol: s.symbol }),
          prevUnderlyingClose: opts.seedLastCloses.get(s.underlying.id),
          prevSynthClose: opts.seedLastCloses.get(s.id),
        };
        const list = synthsByUnderlying.get(s.underlying.id) ?? [];
        list.push(st);
        synthsByUnderlying.set(s.underlying.id, list);
      }

      for await (const tick of inner.subscribe(upstream)) {
        if (passthroughIds.has(tick.asset.id)) {
          yield tick;
        }

        const states = synthsByUnderlying.get(tick.asset.id);
        if (!states) continue;

        const underlyingClose = tick.bar.close;
        for (const st of states) {
          const synthClose = nextSynthClose({
            prevSynthClose: st.prevSynthClose,
            prevUnderlyingClose: st.prevUnderlyingClose,
            underlyingClose,
            leverage: st.synth.leverage,
            expense: st.synth.expense,
          });
          yield {
            asset: st.asset,
            bar: {
              t: tick.bar.t,
              open: synthClose,
              high: synthClose,
              low: synthClose,
              close: synthClose,
              volume: tick.bar.volume,
            },
          };
          st.prevSynthClose = synthClose;
        }
        for (const st of states) {
          st.prevUnderlyingClose = underlyingClose;
        }
      }
    },
  };
}
