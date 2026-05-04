import type { Asset, Bar, DateRange, Frequency } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { SyntheticAsset } from './types';
import { resolveAssetRef } from './asset-ref';

const TRADING_DAYS_PER_YEAR = 252;

async function* synthesize(
  underlyingBars: AsyncIterable<Bar>,
  leverage: number,
  expense: number | undefined,
): AsyncIterable<Bar> {
  const drag = (expense ?? 0) / TRADING_DAYS_PER_YEAR;
  let prevUnderlyingClose: number | undefined;
  let prevSynthClose: number | undefined;
  for await (const u of underlyingBars) {
    let close: number;
    if (prevSynthClose === undefined || prevUnderlyingClose === undefined) {
      close = u.close;
    } else {
      const safe = Number.isFinite(prevUnderlyingClose) && prevUnderlyingClose !== 0;
      const r = safe ? (u.close - prevUnderlyingClose) / prevUnderlyingClose : 0;
      close = prevSynthClose * (1 + leverage * r) * (1 - drag);
    }
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
 * `fundamentals` and `events` methods, if present, are forwarded unchanged.
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
    bars(asset: Asset, range: DateRange, freq: Frequency): AsyncIterable<Bar> {
      const synth = byId.get(asset.id);
      if (!synth) return dataFeed.bars(asset, range, freq);
      const underlying = resolveAssetRef(synth.underlying);
      return synthesize(dataFeed.bars(underlying, range, freq), synth.leverage, synth.expense);
    },
  };

  if (dataFeed.fundamentals) {
    wrapped.fundamentals = dataFeed.fundamentals.bind(dataFeed);
  }
  if (dataFeed.events) {
    wrapped.events = dataFeed.events.bind(dataFeed);
  }

  return wrapped;
}
