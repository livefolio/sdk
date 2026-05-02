# Backtest with realistic slippage and fees

This recipe shows how to configure `BacktestExecutor` with non-zero slippage and
per-share transaction fees, and demonstrates the material impact that execution
costs have on a high-turnover strategy. The same Daily-rebalance strategy is run
twice — once with zero costs (the default) and once with 10 bps of slippage plus
$0.01 per share — so you can read the execution drag directly from the output.

## Why this matters

A backtest with zero slippage overstates real-world returns for any strategy that
trades frequently. Even modest slippage (5–10 bps per side) compounding across
hundreds of trades per year creates a drag of several percentage points. The
`BacktestExecutor` models two cost components:

| Parameter | Description |
|-----------|-------------|
| `slippageBps` | Price impact in basis points; applied as `price × (1 + sign × bps/10000)` |
| `perShareFee` | Fixed dollar fee per share traded, debited from the fill |

## Configuring BacktestExecutor

```ts
import { BacktestExecutor } from '@livefolio/sdk';

// Zero-cost baseline (default)
const executorIdeal = new BacktestExecutor({ calendar, nextOpen });

// Realistic retail costs
const executorReal = new BacktestExecutor({
  calendar,
  nextOpen,
  slippageBps: 10,     // 10 basis points slippage per trade
  perShareFee: 0.01,   // $0.01 per share commission
});
```

Both executors accept exactly the same `nextOpen` function — the cost parameters
are orthogonal to the price source.

## The high-turnover strategy

To make the cost difference measurable, the recipe uses a `Daily` rebalance
cadence with a short SMA(10) crossover. A short period means the signal flips
frequently, producing many orders per month.

```ts
import type { TacticalSpec } from '@livefolio/sdk';

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const SHY = { id: 'us:SHY', symbol: 'SHY' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, SHY],
  rebalance: { frequency: 'Daily' },   // trade every day
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma10', kind: 'sma',   asset: SPY, period: 10 },
  ],
  rules: {
    op:   'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma10' } },
    then: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    else: { op: 'allocate', weights: { 'us:SHY': 1.0 } },
  },
};
```

## Full runnable sample

```ts
// scripts/docs/recipes/realistic-slippage.ts
// npx tsx scripts/docs/recipes/realistic-slippage.ts
import {
  fromSpec, runBacktest, FeatureRuntime,
  NYSEExchangeCalendar, MemoryFeatureCache, BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// ...spec as above...

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(
  start: Date, days: number, basePrice: number, drift: number, period: number
): Bar[] {
  const bars: Bar[] = [];
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price = price * (1 + drift + Math.sin(i / period) * 0.007);
    bars.push({ t, open: price, high: price * 1.005, low: price * 0.995, close: price, volume: 2_000_000 });
  }
  return bars;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-06-01'), 600, 400, 0.0003, 5),
  'us:SHY': makeBars(utc('2022-06-01'), 600, 80,  0.00003, 30),
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

const calendar = new NYSEExchangeCalendar();
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-04-01') };

const nextOpen = async (asset: Asset, t: Date) => {
  const bars = FIXTURES[asset.id]!;
  const next = bars.find(b => b.t.getTime() > t.getTime());
  if (!next) throw new Error(`no bar after ${t.toISOString()}`);
  return { t: next.t, price: next.open };
};

async function runScenario(label: string, slippageBps: number, perShareFee: number) {
  const featureCache = new MemoryFeatureCache();
  const runtime      = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });
  const executor     = new BacktestExecutor({ calendar, nextOpen, slippageBps, perShareFee });
  const strategy     = fromSpec(spec, { runtime, calendar });

  const result = await runBacktest({
    strategy, range,
    initialPortfolio: { cash: 100_000, positions: [], t: range.from },
    dataFeed, executor, calendar,
  });

  const final    = result.snapshots.at(-1);
  const posValue = (final?.portfolio.positions ?? []).reduce((s, p) => s + p.quantity * p.basis, 0);
  const nav      = (final?.portfolio.cash ?? 0) + posValue;
  console.log(`${label}: rebalances=${result.snapshots.filter(s => s.orders.length > 0).length}, nav=$${nav.toFixed(2)}`);
  return nav;
}

const navIdeal = await runScenario('Run A (zero costs)', 0, 0);
const navReal  = await runScenario('Run B (10 bps + $0.01/share)', 10, 0.01);
const drag     = navIdeal - navReal;
console.log(`execution drag: $${drag.toFixed(2)} (${((drag / navIdeal) * 100).toFixed(2)}%)`);
```

## What to notice in the output

- **Rebalance count**: Daily rebalance + short SMA produces a high number of
  trades. Each trade in Run B incurs slippage and fee costs.
- **NAV difference**: the execution drag printed at the end shows the dollar and
  percentage cost of realistic execution vs a theoretical zero-cost benchmark.
- **Different rebalance counts**: Run B may show slightly more or fewer rebalances
  than Run A. This is normal — slippage changes the fill prices, which slightly
  alters the reconciliation logic that decides whether a rebalance is needed.

## Variations to try

- Set `slippageBps: 0` and vary only `perShareFee` to isolate the per-trade
  commission impact from price impact.
- Increase `slippageBps` to `30` (institutional VWAP estimate) and compare
  against the 10 bps retail estimate.
- Switch the strategy to `frequency: 'Weekly'` and observe how dramatically
  the drag shrinks — trading less frequently is often the simplest cost control.

## API references

- [`BacktestExecutor`](/api/classes/BacktestExecutor)
- [`BacktestExecutorOptions`](/api/type-aliases/BacktestExecutorOptions)
- [`NextOpenFn`](/api/type-aliases/NextOpenFn)
- [`Fill`](/api/type-aliases/Fill)
- [`runBacktest`](/api/functions/runBacktest)
