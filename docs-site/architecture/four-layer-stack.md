# Four-layer stack

A portfolio system is a stack. The SDK occupies the middle two layers — Strategy and Execution/Data — and is deliberately indifferent to the layers above and below it. Understanding where the boundaries fall explains why swapping a broker, changing a rule threshold, or adding a second account each touches exactly one layer.

For the complete design rationale, see `docs/specs/2026-04-28-generalized-strategy-architecture-design.md` in the repository.

---

## The picture

```
┌─────────────────────────────────────────────────┐
│  PLAN (above — not yet implemented)             │
│   Capital allocation across strategies          │
│   Multi-account constraints, glidepaths         │
│   AI-assisted strategy authoring                │
├─────────────────────────────────────────────────┤
│  STRATEGY                                       │
│   build(features, portfolio, t) → orders        │
│   tactical.fromSpec  ·  TacticalSpec            │
│   runBacktest                                   │
├─────────────────────────────────────────────────┤
│  EXECUTION + PORTFOLIO ACCOUNTING               │
│   BacktestExecutor  ·  Executor interface       │
│   MemoryFeatureCache  ·  FeatureCache interface │
│   NYSEExchangeCalendar  ·  Calendar interface   │
├─────────────────────────────────────────────────┤
│  MARKET DATA (below — pluggable)                │
│   DataFeed interface                            │
│   @livefolio/datafeed-yfinance (external)       │
│   Any custom feed that implements DataFeed      │
└─────────────────────────────────────────────────┘
```

---

## The Plan layer — above, not yet implemented

The planning layer answers: *which strategies run for which accounts, and with how much capital?* It routes mandates (capital + constraints) down to strategies, aggregates their order output, and enforces cross-account rules. Multi-period optimization (glidepaths, LDI, tax-aware trajectories) and AI-assisted strategy authoring will live here.

v0.4 does not implement the Plan layer. Today's SDK assumes one strategy, one account, one capital pool. The planning abstraction is reserved for a future major version; nothing in the current API needs to change when it arrives.

---

## The Strategy layer — where you author

The strategy layer is the single output boundary the SDK cares about. Every strategy is a function from `(features, portfolio, t)` to a list of orders. Strategies that think in terms of target weights use the `reconcile` helper internally; the executor downstream only sees orders.

v0.4 ships the **tactical dialect**: `TacticalSpec` is plain serializable data (universe, feature declarations, rebalance schedule, rule tree). `tactical.fromSpec` hydrates it into a live `Strategy` whose `build` evaluates the rule tree against computed features and calls `reconcile` to produce orders. This is the spec form used by the parity gate and by the hosted product. Code-form strategies — TypeScript classes implementing the `Strategy` interface directly — are also supported for cases where full power is needed.

The design intention is that `build` is the only method that emits actions. Strategies are stateless; all state is carried by `Portfolio`.

---

## The Execution + Data layer — pluggable seams

This layer has four interfaces. The SDK ships a reference implementation for each; consumers swap any of them without touching strategy code.

**DataFeed** supplies OHLCV bars as an async iterable. The core SDK contains no data provider — `@livefolio/datafeed-yfinance` is a separate package. Your own feed (broker API, local parquet, cloud warehouse) plugs in by implementing the two-method interface. See [`DataFeed`](/api/interfaces/DataFeed).

**Calendar** provides trading-day arithmetic: `isOpen`, `sessions`, `next`, `previous`. `NYSEExchangeCalendar` (NYSE sessions from 1885, including era-varying holidays and ad-hoc closures) and `LSEExchangeCalendar` ship in the box. Non-US strategies implement `Calendar` for their exchange. See [`Calendar`](/api/interfaces/Calendar), [`NYSEExchangeCalendar`](/api/classes/NYSEExchangeCalendar).

**FeatureCache** memoizes indicator results by a content-addressed key so repeated runs and cross-strategy reuse are free. `MemoryFeatureCache` is the default; persistent backends (Redis, DynamoDB, Postgres) implement the same three-method interface. See [`FeatureCache`](/api/interfaces/FeatureCache), [`MemoryFeatureCache`](/api/classes/MemoryFeatureCache), and Content-addressed feature cache (see the Architecture section).

**Executor** receives a batch of orders on each rebalance event and returns fills. `BacktestExecutor` simulates fills at next-session open; a live broker adapter implements the identical interface. See [`Executor`](/api/interfaces/Executor), [`BacktestExecutor`](/api/classes/BacktestExecutor).

Portfolio accounting — lots, cost basis, fill application — is handled by `applyFills` and `applyOrders` inside the SDK's reference runtime. These are pure functions; the portfolio state is just data threaded through `runBacktest`.

---

## Data flow

On each trading session, `runBacktest` drives this sequence:

```
Calendar.sessions(range)
    │  for each session t
    ▼
isRebalanceDay(t, schedule)?
    │  yes
    ▼
DataFeed.bars → FeatureRuntime.resolve(featureSpecs, t)
    │  indicator values, served from FeatureCache if available
    ▼
Strategy.build(features, portfolio, t)
    │  evaluates rule tree → target weights → reconcile → Order[]
    ▼
Executor.submit(orders, portfolio, t)
    │  simulated or live fills
    ▼
applyFills(portfolio, fills)
    │  portfolio updated
    ▼
snapshot recorded → next session
```

Market data flows up (DataFeed → features → strategy). Decisions flow down (strategy → orders → executor → fills → portfolio). The two streams share nothing except the feature values; swapping any component on either stream does not affect the other.

---

## The architectural payoff

Each user-facing change touches exactly one layer:

| What you want to do | Layer affected |
|---|---|
| Backtest a new rule-tree variant | Strategy only |
| Extend backtest from 3 years to 10 years | Data layer (no strategy change) |
| Switch from simulated to live execution | Executor only |
| Add a persistent feature cache | FeatureCache only |
| Use a different exchange calendar | Calendar only |
| Add a second account or strategy | Plan layer (future) |
