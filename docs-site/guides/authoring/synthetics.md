# Synthetics

A `SyntheticAsset` lets you model a derived instrument — a leveraged ETF, an inverse fund, or a fee-bearing wrapper — entirely from the underlying asset's price history, without needing the real product's data. This is useful when backtesting hypothetical leveraged strategies or when you want to measure the drag of a particular expense ratio against an unencumbered index.

## What is a SyntheticAsset?

```ts
type SyntheticAsset = {
  id: AssetId;          // stable id for this synthetic, e.g. 'us:SSO'
  symbol: string;       // display ticker, e.g. 'SSO'
  underlying: AssetRef; // the real asset to derive bars from, e.g. SPY
  leverage: number;     // daily leverage multiplier (2 = 2x, -1 = inverse)
  expense?: number;     // annual expense ratio in percent, e.g. 0.91 for 0.91 %
  tradeAs?: AssetRef;   // if set, orders route to this real ticker at execution
};
```

`withSynthetics` wraps any `DataFeed` so that bar requests for a synthetic `id` are transparently intercepted and synthesised from the underlying asset's bars. The raw `DataFeed` never needs to know about synthetic tickers.

---

## The daily compounding math

Leveraged ETFs reset their exposure daily. The SDK replicates this exactly:

```
close_t = close_{t-1} × (1 + leverage × r_t) × (1 − expense / 252)
```

Where:
- `r_t = (close_t_underlying − close_{t-1}_underlying) / close_{t-1}_underlying` is the underlying's daily return.
- `leverage` scales the return, including sign (use `-1` for an inverse fund).
- `expense / 252` is the per-day fee drag (expense ratio in percent, divided by trading days per year).

On the first bar there is no prior close, so the synthetic close equals the underlying close — effectively anchoring the series to the same starting price.

::: warning Daily reset and long-horizon volatility decay
Because leverage is applied daily rather than held constant, a 2× leveraged product does **not** deliver 2× the long-run return of its index. High-volatility periods erode levered returns through compounding. This is faithful to how real leveraged ETFs work, but it means the backtest result diverges from a naive 2× multiplier over multi-year horizons.
:::

---

## When to use synthetics

| Scenario | Recommended approach |
|----------|----------------------|
| Backtest a real leveraged ETF (SSO, TQQQ, etc.) | Use a synthetic. The SDK's compounding matches how these products actually behave. |
| Compare levered vs unlevered on the same underlying | Use a synthetic for the levered leg; real asset for the unlevered leg. |
| Model fee drag of index funds with different expense ratios | Use a `SyntheticAsset` with `leverage: 1` and the target expense ratio. |
| Trade a real ETF live, but backtest it synthetically | Set `tradeAs` on the synthetic to route live orders to the real ticker. |
| The real product's history exists and is long enough | Use the real asset — no synthetic needed. |

---

## Validation rules

The runtime enforces these constraints when a spec includes `synthetics`:

1. **No self-reference:** `synthetic.id` cannot equal `synthetic.underlying.id`.
2. **Universe collision check:** if a synthetic shares an `id` with a universe `AssetRef`, they must have the same `symbol`, and the underlying must itself be declared in `universe`.
3. **No duplicate ids:** `withSynthetics` throws if the same `id` appears twice in the synthetics array.

These checks run inside `fromSpec` (for the spec-level `synthetics` field) and inside `withSynthetics` (for the DataFeed wrapper). They fire at construction time, not at first bar, so misconfiguration surfaces immediately.

---

## Wiring it together

Pass the synthetics both to the spec and to `withSynthetics`:

```ts
import { withSynthetics, fromSpec } from '@livefolio/sdk';

const SSO: SyntheticAsset = {
  id: 'us:SSO',
  symbol: 'SSO',
  underlying: { id: 'us:SPY', symbol: 'SPY' },
  leverage: 2,
  expense: 0.91,
};

// Wrap the DataFeed — bar requests for 'us:SSO' are now synthesised.
const dataFeed = withSynthetics(rawDataFeed, [SSO]);

// Declare the synthetic in the spec so fromSpec knows it isn't a real ticker.
const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [{ id: 'us:SSO', symbol: 'SSO' }],
  synthetics: [SSO],
  rebalance: { frequency: 'Monthly' },
  features: [],
  rules: { op: 'allocate', weights: { 'us:SSO': 1.0 } },
};

const strategy = fromSpec(spec, { runtime, calendar });
```

The `DataFeed` wrapper is the key step: without it, `FeatureRuntime` would request bars for `'us:SSO'` from the raw feed and get an error (or wrong data).

---

## Sample — unlevered vs 2× levered

The sample below defines an SSO synthetic (2× SPY, 0.91 % expense), runs a fully-invested backtest for each, and prints the final NAVs. It shows both how to wire `withSynthetics` and how the compounding diverges from a simple 2× multiplier.

<<< @/../scripts/docs/guides-authoring/synthetics-leverage.ts

---

## Live streaming with `withStreamingSynthetics`

`withSynthetics` only knows about the historical `DataFeed.bars()` path. A real `StreamingDataFeed` will not recognise a synthetic id like `us:SSO`, so under a naive `runLive` setup the streaming `FeatureRuntime` never receives an `appendBar` for the synthetic — every indicator that reads from its series stays frozen at the last historical close.

`withStreamingSynthetics` is the streaming counterpart: it wraps a `StreamingDataFeed`, subscribes upstream to each synthetic's `underlying`, and re-emits a synthesised tick on the synthetic's id using the same `(1 + leverage × r) × (1 − expense/252)` formula. The two wrappers share a single helper internally so the live path cannot drift from the historical one.

```ts
import { withSynthetics, withStreamingSynthetics, runBacktest, runLive } from '@livefolio/sdk';
import type { AssetId } from '@livefolio/sdk';

const histFeed   = withSynthetics(rawHistoricalFeed, spec.synthetics ?? []);
const history    = await runBacktest({ strategy, dataFeed: histFeed, executor, calendar, range, freq: '1d' });

// Build the seed map from the historical result so the first live tick of the
// synthetic continues smoothly from where the backtest left off — without a
// seed, the first synthesised tick would land on the underlying's price and
// produce a visible jump on the chart.
const seedLastCloses = new Map<AssetId, number>();
for (const [id, bars] of history.bars) {
  const last = bars.at(-1)?.close;
  if (last !== undefined) seedLastCloses.set(id, last);
}

const liveFeed = withStreamingSynthetics(rawStreamingFeed, spec.synthetics ?? [], { seedLastCloses });

for await (const event of runLive({ strategy, history, dataFeed: liveFeed, executor, calendar })) {
  // each tick on `us:SPY` now produces a synthesised tick on `us:SSO` too.
}
```

A few details worth knowing:

- Underlyings the caller did not explicitly subscribe to are subscribed silently — only the synthesised ticks are yielded back.
- Underlyings the caller _did_ subscribe to pass through unchanged in addition to producing synthetics.
- Without a seed entry for a synthetic, the wrapper cold-starts that synthetic at the underlying's first tick (matching how `withSynthetics` anchors the first historical bar). Seeding is what avoids the live jump.
- See **[Replay-then-stream](/recipes/replay-then-stream)** for the broader pattern of carrying state from backtest into live.

---

## What's next

- **[Rule trees](/guides/authoring/rule-trees)** — use synthetic feature values in comparisons (e.g. compare the synthetic's RSI against the underlying's RSI).
- **[Anatomy of a TacticalSpec](/guides/authoring/anatomy-of-a-tactical-spec)** — `synthetics` field in context.
- **API:** [`SyntheticAsset`](/api/type-aliases/SyntheticAsset), [`withSynthetics`](/api/functions/withSynthetics), [`withStreamingSynthetics`](/api/functions/withStreamingSynthetics)
