# @livefolio/sdk

TypeScript SDK for building, backtesting, and live-evaluating tactical
allocation strategies. Define a strategy declaratively as a `TacticalSpec`,
plug in a `DataFeed`, run a backtest. Then continue the same strategy from
the backtest's final state against a `StreamingDataFeed` with `runLive` —
same spec, same rule tree, no hand-off seam between historical and live.

> **Full documentation, guides, and API reference:** [livefolio.github.io/sdk](https://livefolio.github.io/sdk/) — VitePress site auto-generated from source TSDoc, with runnable code samples for every guide.

## Install

```bash
npm install @livefolio/sdk @livefolio/yfinance
```

`@livefolio/yfinance` is one option for the data layer. Implement
your own `DataFeed` for proprietary feeds.

## Quick start

```ts
import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, DateRange } from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';

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
const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = {
  from: new Date('2020-01-01T00:00:00Z'),
  to: new Date('2024-12-31T00:00:00Z'),
};

const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

async function nextOpen(asset: Asset, t: Date) {
  // Look up the next session's open price for this asset.
  // Implementation depends on your data layer; see docs for details.
  throw new Error('implement nextOpen against your data feed');
}

const executor = new BacktestExecutor({ calendar, nextOpen });
const strategy = fromSpec(spec, { runtime, calendar });

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
X over date range Y." `@livefolio/yfinance` is one implementation;
implement your own for proprietary feeds. The interface lives in the root
barrel — `import type { DataFeed } from '@livefolio/sdk'`. For live
evaluation, implement the sibling `StreamingDataFeed` interface
(`subscribe(assets) → AsyncIterable<StreamingBar>`); `runLive` consumes it.

### `Calendar`

Trading-day arithmetic: `isOpen`, `next`, `previous`, `sessions`.
`NYSEExchangeCalendar`, `LSEExchangeCalendar`, and `Crypto24x7Calendar`
(every day a single midnight-UTC-to-next-midnight session) ship in the box.
Select one via `getCalendar('NYSE' | 'LSE')` or instantiate directly.
Pluggable — any class implementing `Calendar` works.

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
portfolio, records snapshots. Returns `{ snapshots, finalPortfolio,
finalState, bars }` — `finalState` and `bars` are the seed inputs for
`runLive`.

### `runLive`

The live evaluation loop. An async generator that takes a `BacktestResult`
plus a `StreamingDataFeed` and emits `LiveEvent<mark | snapshot>` — `mark`
events fire on every tick (current portfolio, prices, features,
preview-build orders) for chart continuity, `snapshot` events fire on
session close (identical shape to `BacktestSnapshot`). Calendar drives
session boundaries; preview orders are computed by re-running
`strategy.build` over a `structuredClone` of state, so the committed state
is never corrupted between rebalances.

See `docs-site/recipes/replay-then-stream.md` for the canonical
backtest-then-stream workflow.

## Imports

Everything is at the root. There is no subpath surface — `@livefolio/sdk` is the only import path you need.

```ts
import {
  // Runtime
  runBacktest, runLive, reconcile,
  // Tactical dialect
  fromSpec, evaluateRuleTree, evaluateFeatureSpecs, withSynthetics, isRebalanceDay,
  // Indicator math
  sma, ema, rsi, returnSeries, volatility, drawdown,
  // Feature runtime
  FeatureRuntime, defineFeature,
  // Reference impls
  NYSEExchangeCalendar, LSEExchangeCalendar, Crypto24x7Calendar, getCalendar, MemoryFeatureCache, BacktestExecutor,
  // Portfolio helpers
  applyFills, applyOrders,
} from '@livefolio/sdk';

import type {
  // Strategy / runtime
  Strategy, BacktestResult, BacktestSnapshot, RunBacktestOptions,
  RunLiveOptions, LiveEvent,
  // Tactical dialect
  TacticalSpec, RuleNode, AssetRef, RebalanceConfig,
  // Interfaces
  Calendar, DataFeed, StreamingDataFeed, StreamingBar, Executor, FeatureCache,
  // Primitives
  Asset, Bar, DateRange, Frequency, Series,
  // Orders / portfolio
  Order, Fill, Position, Portfolio,
} from '@livefolio/sdk';
```

## Design

The architecture is a four-layer stack: strategy-as-data on top, runtime in
the middle, pluggable feeds/executors at the bottom. See
`docs/specs/2026-04-28-generalized-strategy-architecture-design.md` for the
full picture, and `docs/specs/2026-04-29-v0.4-multi-repo-interface-design.md`
for the package layout.

## License

MIT
