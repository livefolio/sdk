# Custom DataFeed

A `DataFeed` is the source of truth for all price bars, fundamentals, and corporate events consumed by a strategy. The SDK ships without a built-in live data adapter by design — you plug in the data source that suits your deployment, whether that is Yahoo Finance, a broker API, a CSV file, or an in-memory fixture. This page explains the contract, common implementation patterns, and how to wire a custom feed into a real backtest.

## Contract

The [`DataFeed`](/api/interfaces/DataFeed) interface has one required method and two optional ones.

```ts
interface DataFeed {
  bars(asset: Asset, range: DateRange, freq: Frequency): AsyncIterable<Bar>;
  fundamentals?(asset: Asset, t: Date): Promise<Fundamentals>;
  events?(range: DateRange, kinds: ReadonlyArray<EventKind>): AsyncIterable<DataEvent>;
}
```

### `bars` — required

- Returns an `AsyncIterable<Bar>`. Use an `async function*` generator to stream bars one at a time; this keeps memory constant for large ranges.
- Bars **must** be yielded in **ascending `t` order**. The backtest engine relies on this ordering for indicator calculations.
- Respect the **half-open interval**: yield bars where `bar.t >= range.from` and `bar.t < range.to`.
- **Omit non-trading periods.** Do not emit synthetic zero-volume bars for weekends or holidays. Gaps are expected and normal.
- The `freq` parameter describes bar width (`'1d'` for daily, etc.). Implement only the frequencies your data provider supports, and throw if an unsupported frequency is requested.

### `fundamentals` — optional

Returns a point-in-time snapshot of fundamental data (P/E ratio, sector, etc.) for an asset as of date `t`. Return `undefined` when no data is available. Omit the method entirely when your provider does not carry fundamentals — consumers feature-detect via `'fundamentals' in feed`.

### `events` — optional

Streams corporate events (earnings, dividends, splits, other actions) in ascending `t` order, filtered to the requested `kinds`. Omit when not supported.

## Real-world example: `YfinanceDataFeed`

The sibling package `@livefolio/yfinance` (in `yfinance/src/yfinance-data-feed.ts`) is a production-grade reference. Key patterns it uses:

- **Symbol translation** — `assetToYahooSymbol(asset)` maps the SDK's `asset.id` format to Yahoo Finance ticker strings.
- **In-process bar cache** (`BarCache`) — A `Map<symbol, Map<freq, Bar[]>>` deduplicates fetches within a single backtest run. The same asset/frequency pair is only fetched once no matter how many features reference it.
- **In-flight deduplication** — A `Map<string, Promise<Bar[]>>` prevents concurrent requests for the same `(symbol, freq)` key from issuing duplicate HTTP calls. The second caller awaits the first caller's promise instead of starting a new request.

```ts
class YfinanceDataFeed implements DataFeed {
  private readonly cache = new BarCache();
  private readonly inflight = new Map<string, Promise<Bar[]>>();

  bars(asset: Asset, range: DateRange, freq: Frequency): AsyncIterable<Bar> {
    return this.iterate(asset, range, freq);
  }

  private async *iterate(asset: Asset, range: DateRange, freq: Frequency) {
    const symbol = assetToYahooSymbol(asset);
    const cached = this.cache.get(symbol, range, freq);
    if (cached) { for (const b of cached) yield b; return; }

    const key = `${symbol}:${freq}`;
    let pending = this.inflight.get(key);
    if (!pending) {
      pending = fetchYahooBars(symbol, range, freq, { includeIncompleteToday: false })
        .then(bars => { this.cache.set(symbol, freq, range, bars); return bars; })
        .finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    const bars = await pending;
    for (const b of bars) {
      if (b.t >= range.from && b.t < range.to) yield b;
    }
  }
}
```

## Sample: `MockDataFeed`

The sample at `scripts/docs/guides-runtime/custom-datafeed.ts` is self-contained and runnable:

```sh
npx tsx scripts/docs/guides-runtime/custom-datafeed.ts
```

<<< @/../scripts/docs/guides-runtime/custom-datafeed.ts

## Things to verify

- [ ] Bars are in ascending `t` order. Sort the source array if your provider doesn't guarantee it.
- [ ] The half-open range filter is correct: `bar.t >= range.from && bar.t < range.to`.
- [ ] No synthetic bars emitted for weekends or holidays — only real sessions.
- [ ] `bars()` throws (or yields nothing) for asset IDs you don't support.
- [ ] Your implementation compiles: `npm run docs:check`.
- [ ] Integration: pass your feed to `runBacktest` and inspect `result.snapshots` to confirm expected session counts.

## What's next

- **Feature cache** — indicator results are memoized on top of your `DataFeed`. See [Custom FeatureCache](./custom-feature-cache) for how caching is keyed and when to replace `MemoryFeatureCache`.
- **Calendar** — the backtest engine uses a `Calendar` to determine which days are sessions. Make sure your `DataFeed` only emits bars on days your calendar considers open. See [Custom Calendar](./custom-calendar).
- **API reference** — [`DataFeed`](/api/interfaces/DataFeed) · [`Bar`](/api/type-aliases/Bar) · [`DateRange`](/api/type-aliases/DateRange).
