# Replicating a v0.3 strategy in v0.4

This recipe is for developers who have an existing v0.3 strategy built with the
fluent `createClient` API and want to port it to v0.4's declarative `TacticalSpec`
format. The canonical example is the SPY/QQQ/IEF weekly trend strategy —
the same spec used as the [parity guarantee](/architecture/parity-guarantee)
regression target — so you can compare the two representations side by side.

## The v0.3 fluent API

In v0.3 a strategy was built imperatively through method calls on a `LivefolioClient`:

```ts
const spy      = client.ticker('SPY')
const qqq      = client.ticker('QQQ')
const ief      = client.ticker('IEF')
const trend    = client.gt(client.price(spy), client.sma(spy, 200))
const bullish  = client.allocation([spy, 0.6], [qqq, 0.4])
const bearish  = client.allocation([ief, 1.0])

client.strategy({
  name: 'my-trend',
  freq: 'Weekly',
  offset: 0,
  rules: [{ when: [trend], hold: bullish }, { hold: bearish }],
})
```

## The v0.4 TacticalSpec equivalent

v0.4 replaces the builder with a plain-data object. There are no method calls,
no closures, and no implicit ordering — the spec is fully serialisable JSON:

```ts
import type { TacticalSpec } from '@livefolio/sdk';

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, QQQ, IEF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price',  kind: 'price', asset: SPY },
    { id: 'spy_sma200', kind: 'sma',   asset: SPY, period: 200 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma200' } },
    then: { op: 'allocate', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};
```

### Mapping v0.3 concepts to v0.4

| v0.3 | v0.4 equivalent |
|------|-----------------|
| `client.ticker(symbol)` | `AssetRef` in `universe[]` |
| `client.price(asset)` | `{ id: '...', kind: 'price', asset }` in `features[]` |
| `client.sma(asset, period)` | `{ id: '...', kind: 'sma', asset, period }` in `features[]` |
| `client.gt(a, b)` | `{ op: 'gt', left: { ref: 'a' }, right: { ref: 'b' } }` |
| `client.allocation([a, w], ...)` | `{ op: 'allocate', weights: { 'id': w } }` |
| `rules: [{ when: [cond], hold }]` | `{ op: 'if', cond, then, else }` |
| `freq: 'Weekly'` | `rebalance: { frequency: 'Weekly' }` |

## Full runnable sample

The sample below runs a full backtest against a synthetic in-memory data feed.
Swap the `dataFeed` for a real adapter (e.g. `@livefolio/datafeed-yfinance`)
without touching the spec or any other part of the code.

```ts
// scripts/docs/recipes/v3-replication.ts
// npx tsx scripts/docs/recipes/v3-replication.ts
import {
  fromSpec, runBacktest, FeatureRuntime,
  NYSEExchangeCalendar, MemoryFeatureCache, BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, QQQ, IEF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price',  kind: 'price', asset: SPY },
    { id: 'spy_sma200', kind: 'sma',   asset: SPY, period: 200 },
  ],
  rules: {
    op:   'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma200' } },
    then: { op: 'allocate', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};

// Synthetic in-memory DataFeed — swap for a real adapter in production
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(start: Date, days: number, basePrice: number, drift: number): Bar[] {
  const bars: Bar[] = [];
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price = price * (1 + drift + Math.sin(i / 10) * 0.004);
    bars.push({ t, open: price, high: price * 1.005, low: price * 0.995, close: price, volume: 1_000_000 });
  }
  return bars;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-01-03'), 800, 450, 0.0004),
  'us:QQQ': makeBars(utc('2022-01-03'), 800, 360, 0.0006),
  'us:IEF': makeBars(utc('2022-01-03'), 800, 100, 0.00003),
};

const dataFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

const calendar     = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range:        DateRange = { from: utc('2023-04-01'), to: utc('2024-01-01') };
const runtimeRange: DateRange = { from: utc('2022-01-03'), to: utc('2024-03-01') };

const runtime  = new FeatureRuntime({ dataFeed, featureCache, range: runtimeRange, freq: '1d' });
const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset: Asset, t: Date) => {
    const bars = FIXTURES[asset.id]!;
    const next = bars.find(b => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`no bar after ${t.toISOString()}`);
    return { t: next.t, price: next.open };
  },
});

const strategy = fromSpec(spec, { runtime, calendar });
const result   = await runBacktest({
  strategy, range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed, executor, calendar,
});

const final = result.snapshots.at(-1);
console.log(`sessions   : ${result.snapshots.length}`);
console.log(`rebalances : ${result.snapshots.filter(s => s.orders.length > 0).length}`);
console.log(`final cash : $${final?.portfolio.cash.toFixed(2)}`);
for (const p of final?.portfolio.positions ?? []) {
  console.log(`  ${p.asset.symbol} qty=${p.quantity}`);
}
```

## What to notice in the output

- **sessions**: one entry per trading day in the range.
- **rebalances**: the number of sessions where the strategy emitted orders. With
  a `Weekly` cadence this is much lower than sessions — typically 4–5 per month.
- **positions**: after the first rebalance the portfolio holds SPY + QQQ (trend on)
  or IEF only (trend off), matching the v0.3 allocation semantics exactly.

## Variations to try

- Change `period: 200` to `period: 50` for a faster signal that reacts to
  shorter-term price movements.
- Add `{ id: 'spy_vol', kind: 'volatility', asset: SPY, period: 20 }` as a
  second feature and nest an `IfNode` to reduce equity exposure in high-vol regimes.
- Replace `NYSEExchangeCalendar` with `LSEExchangeCalendar` to run the same
  spec on UK trading hours.

## API references

- [`TacticalSpec`](/api/type-aliases/TacticalSpec)
- [`fromSpec`](/api/functions/fromSpec)
- [`runBacktest`](/api/functions/runBacktest)
- [`FeatureRuntime`](/api/classes/FeatureRuntime)
- [`BacktestExecutor`](/api/classes/BacktestExecutor)
- [Parity guarantee](/architecture/parity-guarantee)
