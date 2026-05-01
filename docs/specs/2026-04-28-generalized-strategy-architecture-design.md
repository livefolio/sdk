# Generalized Strategy Architecture — Design

**Status:** Vision / Draft
**Date:** 2026-04-28

## Goal

Define an architecture for the SDK that generalizes beyond rule-based tactical strategies to cover the full landscape of investment strategies — strategic, tactical, momentum, risk-parity, vol-targeting, mean-reversion, options, event-driven — and arbitrary combinations of them.

The aim is one strategy shape that:

- Subsumes today's tactical-only API as a special case.
- Composes cleanly: hybrid strategies are function composition, not new primitives.
- Cleanly separates concerns into layers so that each layer can change independently (live broker ↔ backtest sim, swap data feed, add a new account).

This document describes the *target* architecture. It is not a migration plan.

## Non-goals

- Backwards compatibility with the current tactical-only handle API at the source level. The new shape is a superset; how the existing fluent builder maps onto it is a separate concern.
- Defining the broker / execution venue integration surface in detail. Execution is treated as a layer with a known interface; concrete adapters are out of scope.
- Multi-period optimization solvers (LDI, ALM trajectories). The shape supports these as an "above" layer concern but does not specify the optimizer.
- Intraday / microstructure execution (TWAP/VWAP, market-making). Lives "below" the strategy layer; not in scope here.

## The four-layer stack

A portfolio system is a stack. The strategy shape is one layer in the middle. Layers above tell it *why*; layers below tell it *how*.

```
┌─────────────────────────────────────────────────┐
│  ABOVE: Planning / Goals                        │
│   - Which strategies run for which accounts?    │
│   - Capital allocation across strategies        │
│   - Multi-period plan (glidepath, LDI, taxes)   │
│   - Cross-account / cross-strategy constraints  │
├─────────────────────────────────────────────────┤
│  STRATEGY                                       │
│   build(features, portfolio, t) → Order[]       │
├─────────────────────────────────────────────────┤
│  BELOW: Execution / Order management            │
│   - Routing (broker, venue)                     │
│   - Slicing (TWAP/VWAP for large orders)        │
│   - Order types (limit, stop, contingent)       │
│   - Partial fills, retries, cancels             │
│   - Pre-trade risk / compliance                 │
├─────────────────────────────────────────────────┤
│  BELOW: Portfolio accounting                    │
│   - Lots, cost basis, P&L, taxes                │
│   - Corporate actions (splits, divs, mergers)   │
│   - Source of truth for `portfolio` input       │
├─────────────────────────────────────────────────┤
│  BELOW: Market data / event feeds               │
│   - Prices, fundamentals, options chains        │
│   - Event streams (earnings, deals, dividends)  │
│   - Source of truth for `features` input        │
└─────────────────────────────────────────────────┘
```

In a **backtest**, the execution layer is replaced by a simulator (fill at next-bar open, configurable slippage). In **live trading**, it's a broker adapter. The strategy layer does not change between modes.

## Strategy shape

Every strategy is a function from `(features, portfolio, t) → Order[]`. The output is *trade actions*, not target positions. Strategies that think in terms of target weights compute the diff against current portfolio internally (with framework helpers).

```ts
interface Strategy {
  // What is eligible at time t. Often static, sometimes dynamic
  // (top-N by market cap, all current merger deals, underlyings I own).
  universe: (t: Date, portfolio: Portfolio) => Asset[];

  // Per-asset (and possibly cross-asset) derived values.
  // Indicators, fundamentals, covariance matrices, event flags.
  features: (universe: Asset[], portfolio: Portfolio, t: Date) => Features;

  // The single output: orders to apply to the portfolio.
  build: (features: Features, portfolio: Portfolio, t: Date) => Order[];
}
```

`build` is the only mandatory method that emits actions. Inside `build`, strategies compose three canonical helpers — pure functions provided by the framework — to express the two classic modes:

```ts
// Imperative / lifecycle helpers — for position-style strategies
manage(positions, features, t)           → Order[]   // close, roll, adjust
scan(eligible, features, portfolio, t)   → Order[]   // open new positions

// Declarative helper — for weight-style strategies
reconcile(targetWeights, portfolio)      → Order[]   // diff toward target
```

A typical `build` for a hybrid strategy:

```ts
build(features, portfolio, t) {
  const orders: Order[] = [];

  // 1. Position lifecycle (explicit, addressable actions)
  orders.push(...manage(portfolio.positions, features, t));
  orders.push(...scan(eligibleAssets(features), features, portfolio, t));

  // 2. Reconcile remaining capacity to a target allocation
  const projected = applyOrders(portfolio, orders);
  const target    = computeTargetWeights(features, t);
  if (target) {
    orders.push(...reconcile(target, projected));
  }

  // 3. Cross-portfolio overlay (caps, leverage, vol target)
  return overlay(orders, portfolio);
}
```

Pure tactical / strategic strategies omit `manage`/`scan`. Pure options strategies omit `reconcile`. Hybrids use both.

### Why orders, not target weights

A target-weights output forces the framework to invent merge / precedence rules between declarative ("be 60% AAPL") and imperative ("close lot #123") intents. With orders as the single output, the strategy author resolves precedence by call order inside `build` — explicit position actions first, then reconcile against the *projected* state. The executor downstream just executes.

The cost is that idempotency is no longer free — it depends on `reconcile` and `manage`/`scan` always reading current state. The framework guarantees this by making those helpers state-aware and discouraging hand-rolled order construction on the weight path.

## Universe and features

**Universe** answers "what's even on the table at time `t`?" Examples:

| Strategy | Universe |
|---|---|
| 60/40 | `[SPY, AGG]` (static) |
| Tactical (current SDK) | tickers referenced by the rule tree |
| Cross-sectional momentum | S&P 500 constituents as of `t` (time-varying) |
| Risk parity on asset classes | `[stocks, bonds, gold, commodities]` |
| Merger arb | currently announced deals on `t` (event-driven) |
| Earnings drift | names that reported in the last 1–3 days |
| Covered call wheel | underlyings currently held ≥ 100 shares |

**Features** are derived per-asset (or cross-asset) values the strategy reads:

| Kind | Examples |
|---|---|
| Price-derived | SMA, RSI, MACD, trailing return, realized vol |
| Cross-sectional | rank within universe, z-score vs peers, covariance matrix |
| Risk | beta, drawdown, max-loss, expected shortfall |
| Fundamentals | P/E, dividend yield, earnings surprise, revenue growth |
| Events | "reports tomorrow," "ex-div in 3 days," "deal closes Friday" |
| Options | implied vol, delta, gamma, days-to-expiry, moneyness |
| Portfolio-relative | current weight, drift from target, unrealized P&L |

Pulling these out as separate stages enables:

- **Caching** — `SMA(20)` of `SPY` computed once per `t` even if many strategies need it.
- **Substitutability** — swap a fundamentals provider; rotate a momentum-filtered universe under any strategy.
- **Testability** — features are pure `(market, t) → values`; `build` is deterministic given them.
- **Continuity with current SDK** — `IndicatorHandle` and `SignalHandle` are already feature producers. Generalizing means letting features come from other sources (covariance, events, fundamentals, options chains), not just price-derived indicators.

## Position and order model

`build` reads `portfolio.positions` and emits `Order[]`. Both are richer than today's "weight in ticker."

### Position

```ts
interface Position {
  id: PositionId;
  asset: Asset;             // ticker, option contract, futures contract, FX pair
  side: 'long' | 'short';
  quantity: number;         // shares, contracts, notional
  entry: { date: Date; price: number };
  basis: number;            // cost basis (after corp actions)
  expiry?: Date;            // options, futures
  strike?: number;          // options
  legs?: Position[];        // multi-leg structures (spreads, condors)
  tags?: Record<string, unknown>;
}
```

Position state (entry, basis, expiry) is what `manage` reasons over. Stops, time-based exits, and roll triggers are functions of position attributes — the strategy stays stateless.

### Order

```ts
type Order =
  | OpenOrder       // open a new position; specifies asset, side, qty, type, limits
  | CloseOrder      // close an existing position by id (full or partial)
  | AdjustOrder     // modify size/strike/expiry; e.g. roll an option
  | RebalanceOrder; // delta against current quantity (used by reconcile)
```

Order types (market / limit / stop / contingent / multi-leg) live on the order envelope. The execution layer decides how to realize them; the strategy just declares intent.

## Strategy coverage

The shape covers the cleanly-fitting majority of named strategy types:

| Category | universe | helpers used |
|---|---|---|
| Strategic / DCA / glidepath | static / time-indexed | `reconcile` with fixed or `f(t)` weights |
| Tactical (current SDK) | rule-tree tickers | `reconcile` driven by rule outputs over indicator features |
| Cross-sectional momentum | dynamic constituent set | `reconcile` over rank/score features |
| Risk parity / min-var | static asset classes | `reconcile` over solver(covariance) |
| Vol-targeting | any | `overlay` scales any base allocation by realized σ |
| Mean reversion / pairs / stat arb | static or pair list | `scan` on z-score, `manage` on z-cross |
| Merger arb / earnings drift | event-derived | `scan` to open, `manage` to close on resolution |
| Covered calls / wheels / collars | held underlyings | `scan` to open new contracts, `manage` to roll/close |
| Long/short equity | static or screener | signed weights via `reconcile`, or paired `scan`/`manage` |
| Tax-loss harvesting | held lots | `manage` reads lot basis + holding period |
| RL / ML policies | any | `build` = model forward pass |

**Combinations are free.** A "60/40 core + covered-call overlay + vol-target cap + tax-loss harvester" is one strategy whose `build` calls four helpers. No new primitives.

### Where the shape strains

| Class | Why awkward |
|---|---|
| Intraday / microstructure / market-making | Per-bar cadence too coarse; belongs in execution layer |
| Continuous-time optimal control (HJB) | Wants a control policy over continuous state, not discrete `(t) → orders` |
| Multi-period trajectory optimization (LDI, ALM) | Solves for a *path* of weights; lives in the planning layer above |
| Cross-strategy coordination | Solvable via sequencing or a meta-strategy whose `features` include sub-strategies' projected orders |
| Discretionary overrides | Not codifiable; treat as exogenous intents that hit the executor directly |

These don't invalidate the shape — they live above (planning) or below (execution).

## User workflow

### Setup (one-time, top-down)

The user describes their world from the top:

```
1. ABOVE   "Here's my context"
           - Accounts, capital, goals, constraints
           - Capital allocation across strategies

2. STRATEGY  "Pick / configure the strategies"
           - From a library, or author a custom one

3. BELOW   "Connect data + execution"
           - Market data: SDK default or custom feed
           - Portfolio: import broker holdings or start from cash
           - Execution: live broker OR backtest sim
```

### Runtime (cyclical)

On every evaluation tick `t`:

```
   Plan: route mandate (capital + constraints) to strategies
                          │
                          ▼
   Strategy.build(features, portfolio, t)
       reads ↑ features    (from data layer)
       reads ↑ portfolio   (from accounting layer)
       emits ↓ Order[]
                          │
                          ▼
   Executor: route, slice, fill
       emits ↑ Fill[] back to portfolio accounting
                          │
                          ▼
   Portfolio updated; next t
```

Down: plan → mandate → strategy → orders → executor.
Up: market data → features; fills → portfolio state.

### What changing one thing actually touches

| User flow | Layer that changes |
|---|---|
| Backtest an idea over 10 years | Strategy + sim executor + historical data |
| Paper-trade for a month | Strategy + paper executor + live data |
| Run real money | All four layers wired to real accounts |
| Tweak a rule threshold | Strategy only |
| Switch brokers | Executor only |
| Add a new account to the household | Plan only |

This is the architectural payoff: each user-facing change touches one layer.

## Mapping to today's SDK

| Concept | Today | Generalized |
|---|---|---|
| Universe | Implicit (rule tree's tickers) | Explicit `universe(t, portfolio) → Asset[]` |
| Features | `IndicatorHandle`, `SignalHandle` | First-class, plus covariance, events, fundamentals |
| Strategy output | `Allocation` (target weights) | `Order[]` (trade actions); `reconcile` helper covers the weight path |
| Position model | Weight per ticker | Lots, multi-leg, options, futures, FX |
| Execution | Idealized close-price fill in simulator | Pluggable executor interface; sim is one impl |
| Portfolio accounting | Allocation history in `strategies_series` | Lots + corporate actions + cost basis |
| Planning layer | None (one strategy = one mandate) | Capital allocation, multi-account, constraints |

The current tactical SDK is a `Strategy` whose `build` is `reconcile(ruleTree(features), portfolio)`. Everything else is additive surface.

## Effort distribution

Generalizing the strategy *shape* is roughly 20% of the work. The other 80% is the supporting infrastructure each new strategy family demands:

1. **Portfolio / position model** — lots, multi-leg options, futures rolls, FX, fractional shares, corporate actions.
2. **Order model** — market / limit / stop / conditional / contingent / multi-leg, fill semantics.
3. **Feature library** — beyond price-derived indicators: covariance matrices, fundamentals, events, options chains.
4. **Backtest fidelity** — slippage, borrow costs, dividends, assignment, survivorship, point-in-time data.
5. **Execution simulation** — partial fills, queue position, market impact.

Each new strategy family (especially options and event-driven) lights up requirements in several of these.

## Open questions

- **Idempotency contract.** What does the framework guarantee, what must `build` authors guarantee? Probably: helpers are state-aware; ad-hoc order construction outside helpers is an "advanced" path with documented constraints.
- **Conflict policy when `reconcile` undoes a `manage` action** within the same `build` call. Default proposal: explicit position actions are sequenced first, `reconcile` runs against the projected post-action state, so conflict is structural rather than discovered at merge time.
- **Where does the planning layer live in the SDK?** A separate package? An optional wrapper around `Strategy`? "Strategies that emit other strategies" (meta-strategies) vs. a distinct `Plan` abstraction.
- **Feature DAG and caching boundaries.** Reusing the same `SMA(20, SPY)` across strategies / backtests / live runs requires a content-addressed cache. Where it lives (per-process, per-database, per-tenant) shapes the operational story.
- **Live ↔ backtest parity.** Running the same `Strategy` in both modes is the design promise. What's the test that proves parity for a non-trivial strategy on a non-trivial portfolio?
