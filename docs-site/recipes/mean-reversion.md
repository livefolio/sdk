# Mean-reversion with hysteresis

This recipe demonstrates a mean-reversion strategy where the portfolio buys SPY
when its price drops meaningfully below a short-term SMA, and retreats to IEF
(bonds) when SPY recovers. The key feature is **hysteresis**: a `Tolerance` band
around the comparison threshold that prevents the strategy from flipping back and
forth every time price oscillates near the SMA. This is the recommended pattern
for any strategy where you want to avoid excessive whipsaw on rebalance days.

## The hysteresis pattern

Without a tolerance, a `price < SMA` comparison flips state every time price
crosses the SMA — potentially every week. With a 3% relative tolerance:

- The strategy enters SPY when price falls **more than 3% below** SMA.
- It exits SPY only when price rises **more than 3% above** SMA.
- In between, the previous decision is preserved ("sticky").

This is implemented via the `tolerance` and `id` fields on a `Comparison` node.
The `id` is required whenever `tolerance` is set because the runtime must persist
the last-known state across weekly steps.

## The spec

```ts
import type { TacticalSpec } from '@livefolio/sdk';

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, IEF],
  rebalance: { frequency: 'Weekly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma20', kind: 'sma',   asset: SPY, period: 20 },
  ],
  rules: {
    op: 'if',
    cond: {
      id:        'spy_below_sma',           // required when tolerance is set
      op:        'lt',
      left:      { ref: 'spy_price' },
      right:     { ref: 'spy_sma20' },
      tolerance: { value: 3, mode: 'relative' },  // 3% hysteresis band
    },
    then: { op: 'allocate', weights: { 'us:SPY': 1.0 } },  // dip → buy SPY
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },  // above band → bonds
  },
};
```

### How tolerance works

`mode: 'relative'` and `value: 3` means the band is ±3% of the `right` operand
(the SMA). So if SMA is 400:

- The "entry" threshold (flip from IEF→SPY) is at `price < 400 × 0.97 = 388`.
- The "exit" threshold (flip from SPY→IEF) is at `price > 400 × 1.03 = 412`.

`mode: 'absolute'` would instead use a fixed ±3 point band regardless of the
SMA level — useful for fixed-income strategies where the SMA is a spread or yield.

## Full runnable sample

```ts
// scripts/docs/recipes/mean-reversion.ts
// npx tsx scripts/docs/recipes/mean-reversion.ts
import {
  fromSpec, runBacktest, FeatureRuntime,
  NYSEExchangeCalendar, MemoryFeatureCache, BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// ...spec as above...

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(
  start: Date, days: number, basePrice: number, drift: number, amplitude: number
): Bar[] {
  const bars: Bar[] = [];
  let price = basePrice;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price = price * (1 + drift) + Math.sin(i / 6) * amplitude;
    if (price <= 0) price = 1;
    bars.push({ t, open: price, high: price * 1.006, low: price * 0.994, close: price, volume: 1_200_000 });
  }
  return bars;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-06-01'), 700, 400, 0.0003, 6),
  'us:IEF': makeBars(utc('2022-06-01'), 700, 100, 0.00004, 0.1),
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
const range:        DateRange = { from: utc('2023-06-01'), to: utc('2024-06-01') };

const runtime  = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });
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

// Count regime flips (SPY↔IEF transitions)
let flips = 0, prevAsset: string | null = null;
for (const snap of result.snapshots) {
  const dominant = snap.portfolio.positions[0]?.asset.symbol ?? 'CASH';
  if (prevAsset !== null && dominant !== prevAsset) flips++;
  prevAsset = dominant;
}

console.log(`sessions     : ${result.snapshots.length}`);
console.log(`rebalances   : ${result.snapshots.filter(s => s.orders.length > 0).length}`);
console.log(`regime flips : ${flips}  (hysteresis reduces whipsaw)`);
```

## What to notice in the output

- **Regime flips vs rebalances**: regime flips count how many times the portfolio
  switched between SPY and IEF. With hysteresis, this should be noticeably lower
  than the rebalance count — many rebalance days are no-ops because the tolerance
  band holds the previous decision in place.
- **Comparison id**: remove the `id` and `tolerance` fields from the spec and
  rerun — you will see the flip count increase substantially as price noise drives
  the strategy across the SMA boundary repeatedly.
- **Entry/exit asymmetry**: the `op: 'lt'` condition is the entry signal. Once in
  SPY the strategy stays until price exceeds SMA by the tolerance band, producing
  the classic "hold through recovery" mean-reversion behaviour.

## Variations to try

- Set `tolerance: { value: 5, mode: 'relative' }` for a wider band — fewer entries
  but each will correspond to a more extreme oversold condition.
- Increase `period` to `50` or `100` to detect longer-term mean reversion relative
  to a smoother baseline.
- Add a `volatility` feature and gate the entry: only enter SPY when implied
  volatility is below some threshold (`op: 'lt'` on the volatility feature).

## API references

- [`Comparison`](/api/type-aliases/Comparison)
- [`Tolerance`](/api/type-aliases/Tolerance)
- [`RuleTreeState`](/api/type-aliases/RuleTreeState)
- [`TacticalSpec`](/api/type-aliases/TacticalSpec)
- [`fromSpec`](/api/functions/fromSpec)
- [`runBacktest`](/api/functions/runBacktest)
