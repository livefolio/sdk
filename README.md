# @livefolio/sdk

TypeScript SDK for building and backtesting tactical allocation strategies.
Define a strategy declaratively as a `TacticalSpec`, plug in a `DataFeed`, run
a backtest. The same spec is portable across runtimes — pass it to a
backtester today, a paper-trader tomorrow.

## Install

```bash
npm install @livefolio/sdk @livefolio/datafeed-yfinance
```

`@livefolio/datafeed-yfinance` is one option for the data layer. Implement
your own `DataFeed` for proprietary feeds.

## Quick start

```ts
import {
  tactical,
  features,
  runBacktest,
  USEquityCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec } from '@livefolio/sdk/tactical';
import type { Asset, DateRange } from '@livefolio/sdk/interfaces';
import { YfinanceDataFeed } from '@livefolio/datafeed-yfinance';

// 1. Declare the strategy as data.
const SPY = { id: 'us:SPY', symbol: 'SPY' };
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, QQQ, IEF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma200', kind: 'sma', asset: SPY, period: 200 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma200' } },
    then: { op: 'allocate', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};

// 2. Wire the runtime layers.
const dataFeed = new YfinanceDataFeed();
const calendar = new USEquityCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = {
  from: new Date('2020-01-01T00:00:00Z'),
  to: new Date('2024-12-31T00:00:00Z'),
};

const runtime = new features.FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

async function nextOpen(asset: Asset, t: Date) {
  // Look up the next session's open price for this asset.
  // Implementation depends on your data layer; see docs for details.
  throw new Error('implement nextOpen against your data feed');
}

const executor = new BacktestExecutor({ calendar, nextOpen });
const strategy = tactical.fromSpec(spec, { runtime, calendar });

// 3. Run.
const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

console.log(result.snapshots.at(-1));
```

## Concepts

### `TacticalSpec`

A declarative, JSON-shaped strategy: `universe`, `features`, `rebalance`
schedule, and a `rules` tree. Every node in `rules` is either an `if/else`
on a feature comparison, or a leaf `allocate` with target weights. The spec
is plain data — serialize it, store it, version it, send it across a wire.

### `DataFeed`

The data-layer seam: anything that can answer "give me OHLCV bars for asset
X over date range Y." `@livefolio/datafeed-yfinance` is one implementation;
implement your own for proprietary feeds. The interface lives at
`@livefolio/sdk/interfaces`.

### `Calendar`

Trading-day arithmetic: `isOpen`, `next`, `previous`, `sessions`.
`USEquityCalendar` ships in the box. Pluggable for non-US exchanges
(NYSE-faithful port forthcoming).

### `FeatureCache`

Indicator results are content-addressed by `(feature spec, asset, date)`.
`MemoryFeatureCache` ships; bring your own for cross-process caching. The
cache is what makes incremental re-runs cheap.

### `Executor`

The backtest executor records orders/fills/portfolio snapshots.
`BacktestExecutor` ships as the reference impl. Swap for a live broker
adapter in production — the strategy code stays identical.

### `runBacktest`

The runtime loop. Walks calendar sessions, computes features, evaluates the
strategy's rule tree, submits orders to the executor, applies fills to the
portfolio, records snapshots. Returns `{ snapshots, finalPortfolio }`.

## Imports

The package supports both root and subpath imports:

```ts
// Root — common runtime surface
import {
  runBacktest, reconcile,
  USEquityCalendar, MemoryFeatureCache, BacktestExecutor,
  applyFills, applyOrders,
  tactical, features,
} from '@livefolio/sdk';

// Subpath — types and namespace-scoped utilities
import type { TacticalSpec, RuleNode, AssetRef } from '@livefolio/sdk/tactical';
import type { Calendar, DataFeed, Executor, FeatureCache, Asset, Bar, DateRange } from '@livefolio/sdk/interfaces';
import type { Strategy, BacktestResult, BacktestSnapshot } from '@livefolio/sdk/strategy';
import type { Order, Fill, Position, Portfolio } from '@livefolio/sdk';
```

## Design

The architecture is a four-layer stack: strategy-as-data on top, runtime in
the middle, pluggable feeds/executors at the bottom. See
`docs/specs/2026-04-28-generalized-strategy-architecture-design.md` for the
full picture, and `docs/specs/2026-04-29-v0.4-multi-repo-interface-design.md`
for the package layout.

## License

MIT
