import type { Asset, Bar, DateRange, Frequency } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { AssetRef, SyntheticAsset } from './types';

function resolveAsset(ref: AssetRef): Asset {
  return ref.exchange !== undefined
    ? { kind: 'equity', id: ref.id, symbol: ref.symbol, exchange: ref.exchange }
    : { kind: 'equity', id: ref.id, symbol: ref.symbol };
}

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
      const underlying = resolveAsset(synth.underlying);
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
