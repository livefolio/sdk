import type { DataFeed, Asset, Bar, DateRange, Frequency } from '@livefolio/sdk';

/**
 * Minimal in-memory `DataFeed` for the parity workspace. Backed by a symbol
 * → bars map; yields bars in the requested range half-open ([from, to)).
 *
 * Exists so the parity tests don't need to depend on `@livefolio/yfinance`
 * — that package is published separately and not available to CI when this
 * workspace is tested in isolation. The fixture-fed tests never exercised
 * yfinance vendor logic anyway; they just needed a `DataFeed` impl over the
 * vendored fixture JSON.
 */
export class FixtureDataFeed implements DataFeed {
  constructor(private readonly barsBySymbol: Map<string, Bar[]>) {}

  async *bars(asset: Asset, range: DateRange, _freq: Frequency): AsyncIterable<Bar> {
    const bars = this.barsBySymbol.get(asset.symbol);
    if (!bars) throw new Error(`FixtureDataFeed: no fixture for ${asset.symbol}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  }
}
