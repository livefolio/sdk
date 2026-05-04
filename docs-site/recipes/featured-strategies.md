# Featured strategies — Livefolio's flagship specs in v0.4

Four hand-curated tactical strategies originally authored on the v0.3 fluent
API and ported here as plain-data `TacticalSpec`s. They cover the full range
of patterns the v0.4 dialect is meant to express:

| Strategy                  | Cadence | Pattern                                               |
| ------------------------- | ------- | ----------------------------------------------------- |
| Golden Butterfly Tactical | Daily   | Nested if/else with three signals + 5-sleeve fallback |
| Trend Rocket              | Daily   | Single SMA crossover, leverage on / bonds off         |
| Crisis Ready Turbo        | Daily   | Static three-sleeve allocation, no rules              |
| Leveraged Moving Average  | Monthly | Single trend gate, TQQQ-heavy risk-on                 |

Each spec below is a complete strategy — pass it to
[`fromSpec`](/api/functions/fromSpec) and the result drives both
[`runBacktest`](/api/functions/runBacktest) and
[`runLive`](/api/functions/runLive) without any further wiring.

The runnable companion scripts pull live bars from Yahoo Finance via
`@livefolio/yfinance`. The live-run script wraps the same feed with
[`pollingStreamFromHistorical`](/api/functions/pollingStreamFromHistorical) so
the streaming leg also flows through real Yahoo data.

- Backtest all four: [`scripts/docs/recipes/featured-strategies.ts`](https://github.com/livefolio/sdk/blob/main/scripts/docs/recipes/featured-strategies.ts)
- Live run for Trend Rocket: [`scripts/docs/recipes/featured-strategies-live.ts`](https://github.com/livefolio/sdk/blob/main/scripts/docs/recipes/featured-strategies-live.ts)

```bash
npm install @livefolio/yfinance
npx tsx scripts/docs/recipes/featured-strategies.ts
npx tsx scripts/docs/recipes/featured-strategies-live.ts
```

Both scripts hit Yahoo over the network on first run. `YfinanceDataFeed` keeps
a per-instance bar cache so repeated `bars()` calls within the same run dedupe
to a single fetch per `(symbol, freq)` — running all four strategies costs
roughly one cold call per ticker.

## 1. Golden Butterfly Tactical

A regime-aware variant of the classic Golden Butterfly. Three signals on TQQQ
gate four allocations:

- **RSI(14) below 30** → 100% TQQQ to ride the oversold pop.
- **RSI(14) above 80** → 100% SQQQ as a short hedge against the overbought print.
- **Price > SMA(200)** → five-sleeve risk-on portfolio (IAU / UUP / TQQQ / USMV / LCSIX).
- **Otherwise** → five-sleeve defensive portfolio (IAU / UUP / USMV / VTIP / LCSIX, no TQQQ).

```ts
import type { TacticalSpec } from '@livefolio/sdk';

const TQQQ = { id: 'us:TQQQ', symbol: 'TQQQ' };
const SQQQ = { id: 'us:SQQQ', symbol: 'SQQQ' };
const IAU = { id: 'us:IAU', symbol: 'IAU' };
const UUP = { id: 'us:UUP', symbol: 'UUP' };
const USMV = { id: 'us:USMV', symbol: 'USMV' };
const LCSIX = { id: 'us:LCSIX', symbol: 'LCSIX' };
const VTIP = { id: 'us:VTIP', symbol: 'VTIP' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [TQQQ, SQQQ, IAU, UUP, USMV, LCSIX, VTIP],
  rebalance: { frequency: 'Daily' },
  features: [
    { id: 'tqqq_rsi14', kind: 'rsi', asset: TQQQ, period: 14 },
    { id: 'tqqq_price', kind: 'price', asset: TQQQ },
    { id: 'tqqq_sma200', kind: 'sma', asset: TQQQ, period: 200 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'lt', left: { ref: 'tqqq_rsi14' }, right: 30 },
    then: { op: 'allocate', weights: { 'us:TQQQ': 1.0 } },
    else: {
      op: 'if',
      cond: { op: 'gt', left: { ref: 'tqqq_rsi14' }, right: 80 },
      then: { op: 'allocate', weights: { 'us:SQQQ': 1.0 } },
      else: {
        op: 'if',
        cond: { op: 'gt', left: { ref: 'tqqq_price' }, right: { ref: 'tqqq_sma200' } },
        then: {
          op: 'allocate',
          weights: { 'us:IAU': 0.2, 'us:UUP': 0.2, 'us:TQQQ': 0.2, 'us:USMV': 0.2, 'us:LCSIX': 0.2 },
        },
        else: {
          op: 'allocate',
          weights: { 'us:IAU': 0.2, 'us:UUP': 0.2, 'us:USMV': 0.2, 'us:VTIP': 0.2, 'us:LCSIX': 0.2 },
        },
      },
    },
  },
};
```

The nested `IfNode` chain mirrors the implicit ordering of v0.3 rule rows — the
first condition that fires decides the allocation, and a terminal `allocate`
node serves as the fallback. Rule trees are explored in depth in the
[Rule trees guide](/guides/authoring/rule-trees).

## 2. Trend Rocket

A pure trend-follower. When SPY's 5-day SMA is above its 200-day SMA the
strategy goes risk-on with leveraged sleeves; when the trend breaks it falls
back to AGG / GLD / SPY.

```ts
const SPY = { id: 'us:SPY', symbol: 'SPY' };
const TQQQ = { id: 'us:TQQQ', symbol: 'TQQQ' };
const UPRO = { id: 'us:UPRO', symbol: 'UPRO' };
const UGL = { id: 'us:UGL', symbol: 'UGL' };
const GLD = { id: 'us:GLD', symbol: 'GLD' };
const AGG = { id: 'us:AGG', symbol: 'AGG' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [UGL, TQQQ, UPRO, AGG, GLD, SPY],
  rebalance: { frequency: 'Daily' },
  features: [
    { id: 'spy_sma5', kind: 'sma', asset: SPY, period: 5, delay: 1 },
    { id: 'spy_sma200', kind: 'sma', asset: SPY, period: 200, delay: 1 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_sma5' }, right: { ref: 'spy_sma200' } },
    then: { op: 'allocate', weights: { 'us:UGL': 0.3334, 'us:TQQQ': 0.3333, 'us:UPRO': 0.3333 } },
    else: { op: 'allocate', weights: { 'us:AGG': 0.3334, 'us:GLD': 0.3333, 'us:SPY': 0.3333 } },
  },
};
```

`delay: 1` shifts both moving averages one bar back, comparing yesterday's
values rather than today's. That prevents the t=0 bar from leaking into the
crossover decision and matches the v0.3 spec exactly.

The original v0.3 spec also carried a `$1` absolute tolerance band on the
crossover — negligible relative to SPY (~$500). To restore the band, attach a
[`Tolerance`](/api/type-aliases/Tolerance) to the comparison and give the node
a stable `id`:

```ts
cond: {
  id: 'spy_5_vs_200',
  op: 'gt',
  left: { ref: 'spy_sma5' },
  right: { ref: 'spy_sma200' },
  tolerance: { value: 1, mode: 'absolute' },
},
```

## 3. Crisis Ready Turbo

A fixed three-sleeve crisis hedge with a daily rebalance cadence. No rule
branches — the entire strategy is a single `allocate` node.

```ts
const UGL = { id: 'us:UGL', symbol: 'UGL' };
const KMLM = { id: 'us:KMLM', symbol: 'KMLM' };
const UPRO = { id: 'us:UPRO', symbol: 'UPRO' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [UGL, KMLM, UPRO],
  rebalance: { frequency: 'Daily' },
  features: [],
  rules: {
    op: 'allocate',
    weights: { 'us:UGL': 0.33, 'us:KMLM': 0.33, 'us:UPRO': 0.34 },
  },
};
```

A spec with no features and no `IfNode` tree is the simplest tactical/v1 you
can write — useful as a smoke test, as a baseline portfolio benchmark, or as
the constant-weight slot inside a larger composed strategy.

## 4. Leveraged Moving Average

A monthly QQQ trend gate. When QQQ closes below its 200-day SMA the strategy
de-risks into UGL / KMLM / ZROZ; when the trend is intact it goes hard into
TQQQ at 60% with smaller hedges.

```ts
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const TQQQ = { id: 'us:TQQQ', symbol: 'TQQQ' };
const UGL = { id: 'us:UGL', symbol: 'UGL' };
const KMLM = { id: 'us:KMLM', symbol: 'KMLM' };
const ZROZ = { id: 'us:ZROZ', symbol: 'ZROZ' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [UGL, KMLM, ZROZ, TQQQ, QQQ],
  rebalance: { frequency: 'Monthly' },
  features: [
    { id: 'qqq_price', kind: 'price', asset: QQQ },
    { id: 'qqq_sma200', kind: 'sma', asset: QQQ, period: 200 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'lt', left: { ref: 'qqq_price' }, right: { ref: 'qqq_sma200' } },
    then: { op: 'allocate', weights: { 'us:UGL': 0.3334, 'us:KMLM': 0.3333, 'us:ZROZ': 0.3333 } },
    else: { op: 'allocate', weights: { 'us:TQQQ': 0.6, 'us:UGL': 0.15, 'us:KMLM': 0.15, 'us:ZROZ': 0.1 } },
  },
};
```

The `Monthly` cadence means the rule tree is only consulted on the last
trading day of each month; intermediate days emit `mark` events but no
rebalance. See [Rebalance schedules](/guides/authoring/rebalance-schedules)
for the full set of cadences.

## Wiring data — `@livefolio/yfinance` and `@livefolio/fred`

In production you don't write the data layer — install the companion adapters:

```bash
npm install @livefolio/yfinance @livefolio/fred
```

For these four strategies the universes are equity-only, so a single
`YfinanceDataFeed` is enough:

```ts
import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';

const dataFeed = new YfinanceDataFeed();
const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();

const runtimeRange = { from: new Date('2020-01-01'), to: new Date('2024-08-01') };
const range = { from: new Date('2023-01-01'), to: new Date('2024-04-01') };

const runtime = new FeatureRuntime({ dataFeed, featureCache, range: runtimeRange, freq: '1d' });
const strategy = fromSpec(spec, { runtime, calendar });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset, t) => {
    // Pull next-open for fills from the same yfinance feed.
    const range = { from: t, to: new Date(t.getTime() + 7 * 86_400_000) };
    for await (const bar of dataFeed.bars(asset, range, '1d')) {
      if (bar.t.getTime() > t.getTime()) return { t: bar.t, price: bar.open };
    }
    throw new Error(`no next-open bar for ${asset.symbol} after ${t.toISOString()}`);
  },
});

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});
```

If you extend any of these strategies with a macro feature (e.g. gating
allocations on the 10-year Treasury yield from FRED's `DGS10` series), wrap
the equity feed and a `FredDataFeed` together with `RoutingDataFeed` — see
[Composing data feeds](/recipes/composing-data-feeds) for the full pattern.

## Live runs — `pollingStreamFromHistorical` over yfinance

`runLive` consumes a `StreamingDataFeed`, not a `DataFeed`. Yahoo Finance and
FRED are REST-only — neither vendor pushes bars over a socket. The reference
[`pollingStreamFromHistorical`](/api/functions/pollingStreamFromHistorical)
adapter bridges the gap by polling any `DataFeed` on a schedule (interval or
calendar session-close) and dropping duplicates per asset:

```ts
import {
  fromSpec,
  runBacktest,
  runLive,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
  pollingStreamFromHistorical,
} from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';

const calendar = new NYSEExchangeCalendar();
const dataFeed = new YfinanceDataFeed();

// 1. Replay history with the historical feed.
const history = await runBacktest({
  strategy: fromSpec(spec, { runtime, calendar }),
  range,
  dataFeed,
  executor,
  calendar,
  featureCache,
  featureRuntime: runtime, // populates result.bars for the streaming runtime seed
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
});

// 2. Wrap the same DataFeed as a StreamingDataFeed via session-close polling.
const liveFeed = pollingStreamFromHistorical({
  feed: dataFeed,
  freq: '1d',
  schedule: { kind: 'session-close', calendar },
  initialFrom: range.to,
});

// 3. Build a streaming runtime seeded from history.bars and run live.
const streamingRuntime = new FeatureRuntime({
  mode: 'streaming',
  featureCache: new MemoryFeatureCache(),
  freq: '1d',
  initialBars: history.bars,
});

for await (const ev of runLive({
  strategy: fromSpec(spec, { runtime: streamingRuntime, calendar }),
  history,
  dataFeed: liveFeed,
  executor,
  calendar,
  streamingRuntime,
})) {
  if (ev.type === 'snapshot') {
    console.log(ev.t.toISOString(), ev.portfolio.positions.map((p) => `${p.asset.symbol}×${p.quantity}`).join(' '));
  }
}
```

For higher-frequency cadences swap the polling adapter for a true streaming
feed (Polygon, Alpaca, Yahoo WS) — `RoutingStreamingDataFeed` lets you mix a
push-native equity slot with a polling FRED slot in the same universe. See
[Composing streaming data feeds](/recipes/composing-streaming-data-feeds).

## API references

- [`TacticalSpec`](/api/type-aliases/TacticalSpec)
- [`fromSpec`](/api/functions/fromSpec)
- [`runBacktest`](/api/functions/runBacktest)
- [`runLive`](/api/functions/runLive)
- [`pollingStreamFromHistorical`](/api/functions/pollingStreamFromHistorical)
- [`RoutingDataFeed`](/api/classes/RoutingDataFeed) / [`RoutingStreamingDataFeed`](/api/classes/RoutingStreamingDataFeed)
- [Replicating a v0.3 strategy](/recipes/v3-replication) — for a deeper port of the v0.3 fluent API
