# Multi-asset trend-following

This recipe shows how to build a trend-following strategy across multiple
assets — SPY, QQQ, GLD, and TLT — where each asset is evaluated independently
against its own SMA(50). Assets that are above their moving average qualify for
equal-weight allocation; when SPY (the primary anchor) is not trending, the
portfolio falls back entirely to SHY (short-term Treasuries). The pattern
demonstrates multi-asset feature evaluation and cascading conditional allocation
within a single rule tree.

## Strategy design

The core idea: compute `price > SMA(50)` for each risky asset. Allocate
proportionally among the qualifying assets. A linear cascade of `IfNode`s
implements this without requiring a loop construct — each branch adds one
asset to the allocation when its trend is active.

The allocation ladder (from the rule tree below):

| SPY | QQQ | GLD | TLT | Allocation |
|-----|-----|-----|-----|------------|
| off | —   | —   | —   | 100% SHY   |
| on  | off | —   | —   | 100% SPY   |
| on  | on  | off | —   | 50% SPY / 50% QQQ |
| on  | on  | on  | off | ~34% SPY / ~33% QQQ / ~33% GLD |
| on  | on  | on  | on  | 25% each |

## The spec

```ts
import type { TacticalSpec } from '@livefolio/sdk';

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const GLD = { id: 'us:GLD', symbol: 'GLD' };
const TLT = { id: 'us:TLT', symbol: 'TLT' };
const SHY = { id: 'us:SHY', symbol: 'SHY' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, QQQ, GLD, TLT, SHY],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma50', kind: 'sma',   asset: SPY, period: 50 },
    { id: 'qqq_price', kind: 'price', asset: QQQ },
    { id: 'qqq_sma50', kind: 'sma',   asset: QQQ, period: 50 },
    { id: 'gld_price', kind: 'price', asset: GLD },
    { id: 'gld_sma50', kind: 'sma',   asset: GLD, period: 50 },
    { id: 'tlt_price', kind: 'price', asset: TLT },
    { id: 'tlt_sma50', kind: 'sma',   asset: TLT, period: 50 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma50' } },
    then: {
      op: 'if',
      cond: { op: 'gt', left: { ref: 'qqq_price' }, right: { ref: 'qqq_sma50' } },
      then: {
        op: 'if',
        cond: { op: 'gt', left: { ref: 'gld_price' }, right: { ref: 'gld_sma50' } },
        then: {
          op: 'if',
          cond: { op: 'gt', left: { ref: 'tlt_price' }, right: { ref: 'tlt_sma50' } },
          then: { op: 'allocate', weights: { 'us:SPY': 0.25, 'us:QQQ': 0.25, 'us:GLD': 0.25, 'us:TLT': 0.25 } },
          else: { op: 'allocate', weights: { 'us:SPY': 0.34, 'us:QQQ': 0.33, 'us:GLD': 0.33 } },
        },
        else: { op: 'allocate', weights: { 'us:SPY': 0.5, 'us:QQQ': 0.5 } },
      },
      else: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    },
    else: { op: 'allocate', weights: { 'us:SHY': 1.0 } },
  },
};
```

## Full runnable sample

```ts
// scripts/docs/recipes/multi-asset-trend.ts
// npx tsx scripts/docs/recipes/multi-asset-trend.ts
import {
  fromSpec, runBacktest, FeatureRuntime,
  NYSEExchangeCalendar, MemoryFeatureCache, BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// ...spec as above...

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(
  start: Date, days: number, basePrice: number, drift: number, phase: number
): Bar[] {
  const bars: Bar[] = [];
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price = price * (1 + drift + Math.sin((i + phase) / 12) * 0.006);
    bars.push({ t, open: price, high: price * 1.006, low: price * 0.994, close: price, volume: 800_000 });
  }
  return bars;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-01-03'), 900, 450, 0.0004, 0),
  'us:QQQ': makeBars(utc('2022-01-03'), 900, 360, 0.0005, 5),
  'us:GLD': makeBars(utc('2022-01-03'), 900, 175, 0.0002, 10),
  'us:TLT': makeBars(utc('2022-01-03'), 900, 120, -0.0001, 15),
  'us:SHY': makeBars(utc('2022-01-03'), 900, 84,  0.00005, 20),
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

const calendar      = new NYSEExchangeCalendar();
const featureCache  = new MemoryFeatureCache();
const range:         DateRange = { from: utc('2023-04-01'), to: utc('2024-04-01') };
const runtimeRange:  DateRange = { from: utc('2022-01-03'), to: utc('2024-08-01') };

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
for (const p of final?.portfolio.positions ?? []) {
  console.log(`  ${p.asset.symbol} qty=${p.quantity}`);
}
```

## What to notice in the output

- **Rebalances vs sessions**: with `Weekly` frequency you should see roughly
  52 rebalance opportunities across a 1-year backtest, though many will be
  no-ops when the allocation does not change.
- **Allocation shifts**: as the synthetic oscillating prices cross the SMA(50)
  boundary, the strategy switches between SHY (fully defensive) and various
  combinations of SPY/QQQ/GLD/TLT. Watch the positions array change over time.
- **Per-asset isolation**: GLD and TLT follow different oscillation phases,
  so they enter and exit the allocation at different times from SPY/QQQ.

## Variations to try

- Replace `SMA(50)` with `SMA(200)` for a slower signal that filters out more
  noise — you will see fewer rebalances and longer-held positions.
- Add a `return` feature (e.g. `{ kind: 'return', period: 21 }`) for each
  asset and rank assets by momentum score to implement momentum rotation.
- Introduce a `volatility` feature and scale each asset's weight inversely by
  its rolling volatility for a risk-parity style allocation.

## API references

- [`TacticalSpec`](/api/type-aliases/TacticalSpec)
- [`IfNode`](/api/type-aliases/IfNode)
- [`AllocateNode`](/api/type-aliases/AllocateNode)
- [`fromSpec`](/api/functions/fromSpec)
- [`runBacktest`](/api/functions/runBacktest)
