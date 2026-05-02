# First Strategy

This guide walks through a complete working example: an SPY/QQQ/IEF weekly trend strategy that uses an SMA(100) crossover signal. When SPY's price is above its 100-day moving average, the strategy allocates 60 % to SPY and 40 % to QQQ; otherwise it moves entirely into IEF (intermediate Treasuries). The example uses a synthetic in-memory `DataFeed` so it runs without any external service.

## Full source

The sample lives at `scripts/docs/getting-started/first-strategy.ts`. Read it alongside this page.

<<< @/../scripts/docs/getting-started/first-strategy.ts

---

## Step 1 — Define the strategy as a `TacticalSpec`

```ts
const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, QQQ, IEF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma100', kind: 'sma', asset: SPY, period: 100 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma100' } },
    then: { op: 'allocate', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};
```

`TacticalSpec` is plain data — a JSON-shaped object with no class instances or closures. This is intentional: you can serialize it to a database, version it with git, send it across an API boundary, or compare two specs with a deep-equality check. The SDK's runtime is responsible for turning this data into behaviour.

Key fields:

- **`universe`** — the set of assets the strategy may allocate to. Each asset is `{ id, symbol }`, where `id` is the canonical string key used in weight maps.
- **`features`** — a list of named indicators. Each entry declares what to compute (`kind: 'price'`, `kind: 'sma'`), and binds the result to a string `id`. The `id` is the handle used in the `rules` tree.
- **`rebalance`** — how often the strategy reconsiders its allocation. `'Weekly'` means once per trading week.
- **`rules`** — a tree of `if/else` nodes that resolves to a single `allocate` leaf on each rebalance day. The `cond` compares two feature references; `then` and `else` are further nodes or leaf allocations.

See [`TacticalSpec`](/api/type-aliases/TacticalSpec) and [`RuleNode`](/api/type-aliases/RuleNode) in the API reference.

---

## Step 2 — Build a `DataFeed`

```ts
const dataFeed: DataFeed = {
  bars: async function* (asset, range, _freq) {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};
```

`DataFeed` is an interface with a single required method: `bars`. It is an async generator that yields `Bar` objects (OHLCV + timestamp) in ascending time order for a given `(asset, range, frequency)` tuple. The range is half-open: `[from, to)`.

In this example the feed is entirely in-memory. In production you would replace it with `@livefolio/datafeed-yfinance` or your own adapter — the strategy code does not change.

See [`DataFeed`](/api/interfaces/DataFeed) and [`Bar`](/api/type-aliases/Bar).

---

## Step 3 — Wire the runtime layers

```ts
const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: utc('2023-06-01'), to: utc('2024-12-01') };

const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset, t) => { /* ... */ },
});
```

Four runtime layers are required:

| Layer | Purpose | Reference impl used here |
|---|---|---|
| `Calendar` | Trading-day arithmetic (sessions, next/prev day) | `NYSEExchangeCalendar` |
| `FeatureCache` | Memoize indicator results by `(spec, asset, date)` | `MemoryFeatureCache` |
| `DataFeed` | Provide OHLCV bars | synthetic in-memory feed |
| `Executor` | Submit orders, return fills, track portfolio | `BacktestExecutor` |

`FeatureRuntime` wraps the `DataFeed` and `FeatureCache` together; it is the component that resolves feature specs into numeric values for a given date.

`BacktestExecutor` requires a `nextOpen` callback: given an asset and a timestamp, return the next trading session's open price and time. In the example this is satisfied from the same in-memory fixtures.

---

## Step 4 — Hydrate and run

```ts
const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});
```

`fromSpec` converts the plain `TacticalSpec` into a `Strategy<F>` — a typed object the runtime can drive. It does not fetch data or compute anything yet.

`runBacktest` is the runtime loop. It walks every trading session in `range`, computes features via `FeatureRuntime`, evaluates the rule tree, submits any required orders to the executor, applies fills, and records a `BacktestSnapshot` for each session. It returns `{ snapshots, finalPortfolio }`.

See [`fromSpec`](/api/functions/fromSpec) and [`runBacktest`](/api/functions/runBacktest).

---

## Step 5 — Inspect results

```ts
const sessions = result.snapshots.length;
const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
const finalSnapshot = result.snapshots.at(-1);
```

`result.snapshots` is an array of [`BacktestSnapshot`](/api/type-aliases/BacktestSnapshot) — one per trading session. Each snapshot records the portfolio state, any orders submitted, and the fills received. Rebalance sessions are those where `orders.length > 0`.

---

## Run it

From the repository root:

```bash
npx tsx scripts/docs/getting-started/first-strategy.ts
```

Expected output (values depend on the synthetic price series):

```
sessions      : 378
rebalances    : 7
final cash    : $1243.58
positions:
  SPY  qty=142 basis=$52489.23
  QQQ  qty=61  basis=$46267.19
```

---

## What's next

- **[Concepts](/getting-started/concepts)** — the four-layer stack in detail, interface contracts, and how layers compose.
- **Recipes** — swap in a real data feed, implement a custom executor, or extend the feature library.
