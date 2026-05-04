# @livefolio/sdk

TypeScript SDK for building, backtesting, and live-evaluating tactical
allocation strategies. Declare a strategy as a `TacticalSpec`, run it
against historical data with `runBacktest`, then continue from the final
state into live evaluation with `runLive` — same spec, no hand-off seam.

> **Full documentation, guides, and API reference:** [livefolio.github.io/sdk](https://livefolio.github.io/sdk/)

## Install

```bash
npm install @livefolio/sdk @livefolio/yfinance
```

`@livefolio/yfinance` is one option for the data layer. Implement your
own `DataFeed` for proprietary feeds.

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

For live evaluation, recipes, and the full API reference, head to the
[documentation site](https://livefolio.github.io/sdk/).

## Working on this repo

```bash
npm install         # install deps (sdk + parity workspace)
npm test            # run all Vitest suites
npm run build       # bundle to dist/ with tsup
```

### Running the docs site locally

The docs site is VitePress + TypeDoc, sourced from TSDoc comments and
the markdown under `docs-site/`.

```bash
npm run docs:dev      # live-reload dev server at http://localhost:5173
npm run docs:build    # typedoc + vitepress build → docs-site/.vitepress/dist
npm run docs:preview  # serve the production build locally
npm run docs:check    # type-check the runnable code samples in scripts/docs/
```

CI runs `docs:check` separately from `npm test` — run it after touching
public types or sample code.

## License

MIT
