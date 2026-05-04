# Composing data feeds

Most tactical strategies need data from more than one vendor — equity bars from one source, macro time series from another, options chains from a third. The SDK's `RoutingDataFeed` lets you compose multiple `DataFeed`s behind a single interface that `runBacktest`, `FeatureRuntime`, and `BacktestExecutor` all accept unchanged.

This recipe builds a yield-gated SPY/TLT switcher driven by FRED's `DGS10` (10-year Treasury yield), demonstrating how a tactical/v1 spec mixes equity and macro asset kinds in a single universe.

## The strategy

```
if dgs10_yield > 4.5  →  100% TLT  (defensive: long bonds when rates are high)
else                  →  100% SPY  (risk-on: long stocks otherwise)
```

Rebalance monthly. One feature: the latest published 10-year yield, read straight from a FRED-shaped `DataFeed` as the close price of a degenerate OHLCV bar.

## Wiring the universe

Tactical/v1 `AssetRef`s carry an optional `kind` discriminator. Without it, every asset defaults to `'equity'` (backward compatible with existing specs). Mark macro assets explicitly:

```ts
const SPY    = { id: 'us:SPY', symbol: 'SPY' };
const TLT    = { id: 'us:TLT', symbol: 'TLT' };
const DGS10  = { kind: 'macro' as const, id: 'DGS10', symbol: '10Y Treasury' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, TLT, DGS10],
  // ...
};
```

The dialect resolves each `AssetRef` to a runtime `Asset`. SPY and TLT become `EquityAsset`; DGS10 becomes `MacroAsset`. The kind survives all the way to the `DataFeed.bars` call, where the router uses it for dispatch.

## Composing the feeds

```ts
import { RoutingDataFeed } from '@livefolio/sdk';

const dataFeed = new RoutingDataFeed({
  equity: equityFeed,   // any DataFeed for equity assets
  macro:  macroFeed,    // any DataFeed for macro assets
});
```

The map keys are `Asset['kind']` discriminants. The router's `bars(asset, range, freq)` looks up `asset.kind` in the map and delegates the call to the matching feed. `RoutingDataFeed` itself implements `DataFeed`, so `runBacktest`, `FeatureRuntime`, and `BacktestExecutor` accept it without modification.

For more advanced routing (e.g. a free vendor for most assets and a paid vendor for an allowlist), the constructor also accepts a function `(asset) => DataFeed | undefined`.

## Production wiring

In a real deployment you swap the synthetic feeds in this recipe for the real vendor adapters. They install side-by-side with the SDK:

```bash
npm install @livefolio/yfinance @livefolio/fred
```

```ts
import { RoutingDataFeed } from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';
import { FredDataFeed } from '@livefolio/fred';

const dataFeed = new RoutingDataFeed({
  equity: new YfinanceDataFeed(),
  macro:  new FredDataFeed({ apiKey: process.env.FRED_API_KEY! }),
});
```

`YfinanceDataFeed` reads OHLCV bars from Yahoo Finance for equity assets. `FredDataFeed` reads macro time series from FRED's `series/observations` endpoint and yields each observation as a degenerate OHLCV bar (`open=high=low=close=value`, `volume=0`). Pass the same composed feed everywhere a `DataFeed` is required — the SDK doesn't see the seam.

## Full code

The runnable script lives at `scripts/docs/recipes/composing-data-feeds.ts`. Run it with:

```bash
npx tsx scripts/docs/recipes/composing-data-feeds.ts
```

Synthetic in-memory feeds make the script offline-runnable; in production swap them for `YfinanceDataFeed` and `FredDataFeed` as shown above.

```ts
// Recipe: Composing data feeds with RoutingDataFeed
//
// Tactical/v1 strategies often need data from more than one vendor —
// equity bars from one source (e.g. Yahoo) and macro time series from
// another (e.g. FRED). This recipe shows how to wire them together via
// `RoutingDataFeed`, which dispatches each `bars()` call to the right
// inner feed based on `asset.kind`.
//
// The strategy is a single-yield gate: when the 10-year Treasury yield
// (FRED series DGS10) is above 4.5%, allocate 100% to TLT; otherwise
// 100% to SPY. Rebalance monthly.
//
// In production you'd use:
//   const equity = new YfinanceDataFeed();
//   const macro  = new FredDataFeed({ apiKey: process.env.FRED_API_KEY! });
// This script substitutes hand-written synthetic feeds so it runs offline.
//
//   npx tsx scripts/docs/recipes/composing-data-feeds.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
  RoutingDataFeed,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// --- 1. Assets ------------------------------------------------------------

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const TLT = { id: 'us:TLT', symbol: 'TLT' };
// Macro asset — annotated with `kind: 'macro'` so the dialect resolves it to
// a MacroAsset, and RoutingDataFeed sends it to the macro inner feed.
const DGS10 = { kind: 'macro' as const, id: 'DGS10', symbol: '10Y Treasury' };

// --- 2. Strategy spec -----------------------------------------------------
//
// Rule tree: a single if/else gate on the 10y yield.
//   dgs10_yield > 4.5  →  100% TLT
//   else               →  100% SPY

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, TLT, DGS10],
  rebalance: { frequency: 'Monthly' },
  features: [{ id: 'dgs10_yield', kind: 'price', asset: DGS10 }],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'dgs10_yield' }, right: 4.5 },
    then: { op: 'allocate', weights: { 'us:TLT': 1.0 } },
    else: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
  },
};

// --- 3. Synthetic equity feed --------------------------------------------

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeEquityBars(start: Date, days: number, basePrice: number, drift: number, phase: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price = price * (1 + drift + Math.sin((i + phase) / 12) * 0.006);
    bars.push({ t, open: price, high: price * 1.006, low: price * 0.994, close: price, volume: 800_000 });
  }
  return bars;
}

const EQUITY_FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeEquityBars(utc('2022-01-03'), 900, 450, 0.0004, 0),
  'us:TLT': makeEquityBars(utc('2022-01-03'), 900, 95, -0.0001, 30),
};

const equityFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = EQUITY_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-data-feeds: no equity fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// --- 4. Synthetic macro feed ---------------------------------------------
//
// DGS10 oscillates between roughly 3.8% and 5.0% with a ~6-month cycle.
// Crosses 4.5% in both directions during a 1-year window so the recipe
// shows the yield-gate triggering both branches of the rule tree.

function makeMacroBars(start: Date, days: number): Bar[] {
  const bars: Bar[] = [];
  const MS_DAY = 86_400_000;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * MS_DAY);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    const yieldValue = 4.4 + Math.sin(i / 60) * 0.6;
    bars.push({ t, open: yieldValue, high: yieldValue, low: yieldValue, close: yieldValue, volume: 0 });
  }
  return bars;
}

const MACRO_FIXTURES: Record<string, Bar[]> = {
  DGS10: makeMacroBars(utc('2022-01-03'), 900),
};

const macroFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = MACRO_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-data-feeds: no macro fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// --- 5. Compose with RoutingDataFeed --------------------------------------

const dataFeed = new RoutingDataFeed({
  equity: equityFeed,
  macro: macroFeed,
});

// --- 6. Runtime -----------------------------------------------------------

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-04-01') };
// Give FeatureRuntime the full fixture window so price features have history.
const runtimeRange: DateRange = { from: utc('2022-01-03'), to: utc('2024-08-01') };

const runtime = new FeatureRuntime({ dataFeed, featureCache, range: runtimeRange, freq: '1d' });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset: Asset, t: Date) => {
    // Only equity assets are ever traded by this strategy.
    const bars = EQUITY_FIXTURES[asset.id];
    if (!bars) throw new Error(`composing-data-feeds: no fill fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`composing-data-feeds: no bar after ${t.toISOString()} for ${asset.id}`);
    return { t: next.t, price: next.open };
  },
});

// --- 7. Run ---------------------------------------------------------------

const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

// --- 8. Print summary -----------------------------------------------------

const sessions = result.snapshots.length;
const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
const tltSessions = result.snapshots.filter((s) =>
  s.portfolio.positions.some((p) => p.asset.id === 'us:TLT' && p.quantity > 0),
).length;
const spySessions = result.snapshots.filter((s) =>
  s.portfolio.positions.some((p) => p.asset.id === 'us:SPY' && p.quantity > 0),
).length;
const final = result.snapshots.at(-1);
// Position.basis is the total cost basis of the position (fill price * shares + fees),
// not per-share. We sum it to estimate invested capital. This is a cost-basis estimate,
// not mark-to-market — for an exact NAV the strategy would need to mark each position
// against the latest available bar.
const investedBasis = (final?.portfolio.positions ?? []).reduce((sum, p) => sum + p.basis, 0);
const investedCash = (final?.portfolio.cash ?? 0) + investedBasis;

console.log('=== composing-data-feeds recipe ===');
console.log(`sessions             : ${sessions}`);
console.log(`rebalances           : ${rebalances}`);
console.log(`SPY sessions         : ${spySessions}  (yield <= 4.5% -- risk-on)`);
console.log(`TLT sessions         : ${tltSessions}  (yield > 4.5% -- defensive)`);
console.log(`final cash           : $${(final?.portfolio.cash ?? 0).toFixed(2)}`);
console.log(`final position basis : $${investedBasis.toFixed(2)}`);
console.log(`cash + basis         : $${investedCash.toFixed(2)}`);
```

## What you should see

```
=== composing-data-feeds recipe ===
sessions             : 249
rebalances           : 6
SPY sessions         : 147  (yield <= 4.5% -- risk-on)
TLT sessions         : 84  (yield > 4.5% -- defensive)
final cash           : $15.72
final position basis : $103535.18
cash + basis         : $103550.90
```

`SPY sessions` is the count of trading days the portfolio held SPY (yield ≤ 4.5%). `TLT sessions` is the count of days it held TLT (yield > 4.5%). The synthetic DGS10 fixture is built to cross 4.5% in both directions during the backtest window so both branches of the rule tree fire.

`cash + basis` is a cost-basis estimate of total invested capital, not a mark-to-market NAV. For an exact NAV you'd mark each open position against the latest available bar.

## Notes

- **Forgetting to register `macro`** in the route map produces `RoutingDataFeedError: no feed registered for asset.kind="macro" (id="DGS10")`. Catch this at construction by listing every kind your spec uses.
- **`MacroAsset` doesn't carry `exchange`.** Adding an `exchange` field to a macro `AssetRef` is silently dropped during resolution; only equity assets propagate it.
- **`fundamentals` and `events`** on the routed feed are forwarded by kind exactly the way `bars` is, but the router does not currently fan out `events()` across multiple feeds. See the API reference for `RoutingDataFeed`.

## See also

- [`RoutingDataFeed` API](/api/classes/RoutingDataFeed)
- [Custom DataFeed](/guides/runtime/custom-data-feed)
- [Anatomy of a TacticalSpec](/guides/authoring/anatomy-of-a-tactical-spec)
