# Rate Ticker Financing Legs in Simulation

**Status:** draft
**Date:** 2026-04-16

## Background

Strategies in the wild use rate tickers (`DTB3`, `DFF`) with **signed weights** to express financing:

- `{"VT": 0.32, "GLD": 0.10, "IEF": 0.20, "DBMF": 0.30, "DTB3": -0.17, "VT?L=2": 0.25}` — 117% gross long, funded by -17% "short T-bills" (a borrow at the DTB3 rate)
- `{"DTB3": 1.0}` — 100% parked cash earning DTB3 interest
- `{"GLD": 0.6, "QQQ": 0.6, "DTB3": -2.0, "KMLM": 0.6, "ZROZ": 0.6, "DFSVX": 0.6}` — 300% gross long, -200% funding

Weights still sum to 1; `DTB3` plays the role of a funding rate, not a tradeable security.

The current simulator (`sdk/src/backtest/simulate.ts`) treats every non-CASHX ticker uniformly: `targetShares = targetValue / price`. For `DTB3` at a negative weight this yields a negative share count, which the final `PortfolioHandle` constructor rejects:

```
Quantity for DTB3 is negative: -745265.57
```

Once any share count goes negative it cascades — subsequent rebalances compute from a distorted NAV, producing stray negatives in unrelated tickers (`SPY: -0.41`, `GLD: -0.017`).

6 strategies in the latest full backtest fail for this reason.

## Goal

Model rate-ticker weights as financing legs that accrue daily interest at the FRED convention (`rate × days / 360`), using a unified representation that is forward-compatible with general short selling of equities.

## Non-goals

- General short selling of equity tickers (the data model supports it after this change, but the simulator's P&L model for equity shorts is out of scope here — no borrow cost, no hard-to-borrow mechanics).
- Chained simulations that continue accruing interest across `simulate()` calls.
- Changing the rate source, the list of classified rate tickers, or any rate-ingest behavior.

## Design

### Unified position model

Rate tickers become regular entries in `positions` where:

- **Share count equals dollar amount.** A rate ticker trades at an implicit price of `$1`. `positions["DTB3:1"] = -500` literally means "$500 borrowed."
- **The stored "price" series is the raw rate (in percent)**, used only for accrual, never for NAV valuation.

Rationale: this removes the dichotomy between rate legs and share legs, unifies rebalance code, and makes the "allow negative quantity" relaxation a natural fit for the equity short case later.

### Daily accrual (FRED convention)

At every bar, **before** rebalance check:

```
for each rate ticker in positions:
  days = calendar days between prev bar and current bar
  rate = prices[rateKey][prev_bar_date] / 100   // stored as percent, e.g. 5.25 → 5.25%
  positions[rateKey] *= 1 + leverage × rate × days / 360
```

- Uses the **previous bar's** rate (end-of-day convention: the rate in effect during the gap is the rate posted at its start).
- Skips the first bar (no gap).
- If `prices[rateKey][prev_bar_date]` is missing, skip accrual for that step — do not fabricate a rate.
- `leverage` comes from the ticker's `leverage` field; the default is 1. Users can write `DTB3?L=2` to borrow/lend at twice the T-bill rate (a user-facing interpretation of leverage on rate tickers, chosen for symmetry with equity leverage semantics).

### Leverage handling in indicator sync

`sdk/src/handles/indicator.ts` currently applies leverage to a `Price` series by compounding daily returns (`prev × (1 + L × dailyReturn)`). This is meaningless for a rate.

For rate tickers (detected via `isRateTickerSymbol(ticker.symbol)`), skip the leverage-compounding block. The stored Price series for `DTB3?L=2` is identical to `DTB3?L=1` — just the raw rate. The simulator applies leverage at accrual time.

### Rebalance logic

Unchanged from current code. The existing flow already handles rate tickers once `_priceFor` returns `1`:

```
targetValue   = NAV × weight                      // can be negative
targetShares  = targetValue / 1 = targetValue     // share count = dollar amount
delta         = targetShares - currentShares
cash         -= delta × 1
positions[rateKey] = targetShares
```

No new `Trade.action` values. Positive `delta` emits `buy` (= "lend more" / "unwind borrow"), negative `delta` emits `sell` (= "borrow more" / "unwind lending").

### `PortfolioHandle` changes

1. Drop the `quantity < 0` throw in the constructor.
2. `_priceFor(ticker)` returns `1` when `ticker.symbol === 'CASHX' || isRateTickerSymbol(ticker.symbol)`. Everything else unchanged.
3. `weights()` math is unchanged — already correct for portfolios where some positions have negative dollar value.

### Final portfolio

No collapse step needed. `positions["DTB3:1"] = -500.07` at termination is preserved in `finalPortfolio`. `finalPortfolio.value(prices)` works correctly because `_priceFor` returns 1 for rate tickers.

Cash can end negative if the last rebalance leaves an unwound financing leg with residual cash deficit; that is a valid state (matches real brokerage P&L) and the relaxed `PortfolioHandle` invariant accepts it.

### `NAV` computation

In `simulate.ts`:
```
NAV = cash + Σ (positions[key] × priceFor(key))
```
where `priceFor(key)` is `1` for rate tickers and `CASHX`, else `prices[key][date]`.

The current `simulate.ts:50-53` valuation loop already multiplies `shares × price` and skips missing prices. The change: for rate tickers, `price = 1` regardless of `prices[key][date]` content (which holds the rate, not a price).

### Missing-rate handling

If `prices[rateKey][date]` is missing at a bar, the simulator still knows the ticker's `$1` valuation (no price needed). Accrual for that step is skipped. The financing balance carries forward unchanged. This is consistent with how missing equity prices are handled by `valuationPrice`'s carry-forward logic.

## Data flow

1. User writes a strategy with `{DTB3: -0.5, SPY: 1.5}`.
2. SDK resolves these into `TickerHandle`s; rate tickers are classified via `isRateTickerSymbol`.
3. Simulator loop: per bar, (a) accrue rate positions if non-first-bar, (b) if rebalance date, compute target shares (rate legs use implicit price 1), update cash and positions, (c) compute NAV.
4. Final `PortfolioHandle` accepts possibly-negative `DTB3` and `CASHX` quantities.

## Testing

New unit tests:

- **`indicator.test.ts`** — Price indicator for `DTB3?L=2` stores raw rate (identical to `DTB3?L=1`); verify by comparing series.
- **`portfolio.test.ts`** — constructor accepts negative quantities; `value()`/`weights()` handle a mixed `{SPY: +100, DTB3: -500, CASHX: +200}` correctly; `_priceFor` returns 1 for `DTB3`.
- **`simulate.test.ts`** — four scenarios:
  1. **Pure lending**: start $100k, allocation `{DTB3: 1.0}`, constant 5% rate across N bars that span D total calendar days. Expected final NAV = `100_000 × ∏(1 + 0.05 × days_i / 360)` for each bar-to-bar gap `days_i`; assert within 1e-6 of the analytic product.
  2. **Long lev + borrow**: `{SPY: 1.5, DTB3: -0.5}` with constant SPY returns and constant DTB3 rate. At each bar, expected NAV change = `1.5 × Δ_SPY_$ − 0.5 × NAV × rate × days / 360` (borrow *subtracts* from NAV; the signs emerge because `positions[DTB3] < 0` and accrual multiplies it further negative).
  3. **Leveraged rate**: `{DTB3?L=2: -0.5}`, verify per-bar accrual matches twice the base rate via the share-count-compounding formula.
  4. **Rebalance transition**: sim goes `{DTB3: -0.5, SPY: 1.5}` → `{CASHX: 1.0}` mid-sim; after the transition rebalance, `positions["DTB3:1"]` is 0, `positions["SPY:1"]` is 0, and `cash == NAV` (financing fully unwound).
  5. **Missing rate**: if `prices[rateKey][date]` is null for one step, the financing balance is unchanged for that step (no fabricated rate) and subsequent steps accrue normally.

Integration: rerun the 6 previously-failing strategies (`2gYdhZb9hgN`, `in3StwdSG57`, `aP4RycvnG3b`, `59iA4m6mfKm`, `icp6eVMQOGo`, `bqZ1J4pFLvD`) via `cli/scripts/backtest-all.ts --only <list>` — all should succeed.

## Files touched

- `sdk/src/backtest/simulate.ts` — per-bar accrual, rate-ticker special case in NAV/rebalance (implicit price 1)
- `sdk/src/handles/portfolio.ts` — drop non-negative invariant; extend `_priceFor` to return 1 for rate tickers
- `sdk/src/handles/indicator.ts` — skip leverage compounding for rate-ticker Price series
- `sdk/src/providers/mappings.ts` — already exports `isRateTickerSymbol`; no change expected unless we widen the rate set

Tests: `sdk/src/handles/portfolio.test.ts`, `sdk/src/handles/indicator.test.ts`, `sdk/src/backtest/simulate.test.ts`.

## Out of scope

- Equity shorting P&L model (no borrow fee, no corporate-action handling)
- Multi-currency funding rates
- Backfill/repair of existing stored `DTB3?L=2` indicator series that were leverage-compounded by the old code path (users rerunning will re-sync fresh; if that proves costly, a one-off migration can drop those rows)

## Verification

1. `sdk && npm test` — unit suite green.
2. `market && npm run build && sdk && npm run build`.
3. `cli && npx tsx scripts/backtest-all.ts --from 2020-01-01 --to 2025-12-31 --only 2gYdhZb9hgN,in3StwdSG57,aP4RycvnG3b,59iA4m6mfKm,icp6eVMQOGo,bqZ1J4pFLvD --out verify-financing.csv` — 0 errors.
4. Full 70-strategy rerun — expect 6 → 0 remaining `Quantity negative` errors (plus the unrelated malformed-strategy failure).
