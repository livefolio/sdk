# Rebalance schedules

The `rebalance` field of a `TacticalSpec` controls how often the rule tree is evaluated and orders are generated. Choosing the right cadence is a trade-off between signal responsiveness and trading costs. This page explains the supported frequencies, how the runtime decides which sessions are rebalance days, and how to reason about the trade-offs.

## Supported frequencies

```ts
type RebalanceFrequency = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
```

| Frequency | When the rule tree runs |
|-----------|------------------------|
| `'Daily'` | Every trading session |
| `'Weekly'` | The last trading day of each ISO week (usually Friday) |
| `'Monthly'` | The last trading day of each calendar month |
| `'Quarterly'` | The last trading day of each calendar quarter (Mar/Jun/Sep/Dec) |
| `'Yearly'` | The last trading day of each calendar year |

If you omit the `rebalance` field entirely, the default is `'Daily'`.

```ts
// Equivalent — both rebalance every trading day
const specA: TacticalSpec = { kind: 'tactical/v1', universe: [...], features: [...], rules: ... };
const specB: TacticalSpec = { kind: 'tactical/v1', universe: [...], rebalance: { frequency: 'Daily' }, features: [...], rules: ... };
```

---

## How `isRebalanceDay` works

The runtime calls [`isRebalanceDay`](/api/functions/isRebalanceDay) on each trading session to decide whether to invoke the rule tree:

```ts
function isRebalanceDay(t: Date, freq: RebalanceFrequency, calendar: Calendar): boolean;
```

For `'Daily'` it always returns `true`. For all other frequencies it checks whether today is the **last trading day of its period**: it computes the `periodKey` for today and for the next trading day, and returns `true` when they differ. Because the check uses `calendar.next(t)`, it correctly accounts for exchange-specific holidays — a Friday before a long weekend is treated as the end of the week even if the nominal last day would be a non-trading day.

The [`Calendar`](/api/interfaces/Calendar) you pass to `fromSpec` (and subsequently to `runBacktest`) determines which days count as trading sessions. The reference implementations [`NYSEExchangeCalendar`](/api/classes/NYSEExchangeCalendar) and [`LSEExchangeCalendar`](/api/classes/LSEExchangeCalendar) encode each exchange's full holiday schedule.

---

## Trade-off analysis

### Turnover and costs

More frequent rebalancing means more orders per year. Each order incurs transaction costs (brokerage commissions, bid-ask spread, market impact). In a backtest the `BacktestExecutor` fills at next-open prices, so costs are implicit in the slippage from signal-time price to execution price.

| Frequency | Approximate rebalances/year | Turnover |
|-----------|-----------------------------|----------|
| Daily | ~252 | Very high |
| Weekly | ~52 | High |
| Monthly | ~12 | Moderate |
| Quarterly | ~4 | Low |
| Yearly | ~1 | Very low |

::: tip Rule of thumb
For trend-following strategies based on slow indicators (SMA 50–200), `'Weekly'` or `'Monthly'` is typically sufficient. The signal changes slowly enough that daily rebalancing adds no information but doubles or triples turnover.
:::

### Signal staleness

The trade-off runs the other way for faster signals. A strategy using a 5-day RSI and rebalancing monthly is measuring a fast indicator but acting on a slow schedule — the signal may have reversed multiple times before the next rebalance fires.

### Hysteresis as a complement

Even at `'Weekly'` rebalancing, price oscillation around a threshold can cause flip-flopping. Hysteresis (see [Rule trees](/guides/authoring/rule-trees)) addresses this orthogonally: it suppresses whipsaw without changing the rebalance frequency. Combining a moderate frequency (`'Weekly'`) with a hysteresis band (`tolerance: { value: 2, mode: 'relative' }`) is the recommended pattern for trend strategies.

---

## Mixing features and cadence

Feature indicators are always computed at daily granularity by the `FeatureRuntime` — the rebalance frequency only controls when the rule tree is evaluated. A monthly rebalancing strategy still benefits from daily price data feeding the SMA computation; it just acts on the signal at most once per month.

This means a `'Monthly'` strategy with `{ kind: 'sma', period: 200 }` uses all 200 daily closes for the SMA computation but generates at most 12 rebalance events per year.

---

## Sample — weekly vs monthly event count

The sample below runs the same SPY/IEF trend strategy at `'Weekly'` and `'Monthly'` cadences and reports the total number of rebalance events and orders for each. The output illustrates the turnover difference directly.

<<< @/../scripts/docs/guides-authoring/rebalance-weekly.ts

---

## What's next

- **[Rule trees](/guides/authoring/rule-trees)** — use hysteresis to reduce flip-flopping at any rebalance frequency.
- **[Anatomy of a TacticalSpec](/guides/authoring/anatomy-of-a-tactical-spec)** — full field reference including `rebalance`.
- **API:** [`RebalanceConfig`](/api/type-aliases/RebalanceConfig), [`isRebalanceDay`](/api/functions/isRebalanceDay)
