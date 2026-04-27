# Simulation Metrics Design Specification

**Date:** 2026-04-26
**Status:** Draft

## Overview

Add a metrics module that turns a `SimulationHandle` into a structured set of performance, risk, and activity statistics — the kind of summary a backtesting UI (e.g. testfol.io) shows next to an equity curve. All math is hand-written TypeScript in a new `src/metrics/` module; no native or third-party dependencies. The module reads `simulation.series` (daily NAV) and `simulation.trades` only — no I/O, fully synchronous.

Out of scope for v1: benchmark-relative stats (beta/alpha/capture), per-position win rate, allocation decomposition, configurable annualization. Each of these can be added later without breaking the v1 API.

## Public API

Two surfaces:

1. **Ergonomic entry point** on the existing `SimulationHandle`:

   ```typescript
   const result = sim.metrics();                          // defaults
   const result = sim.metrics({ riskFreeRate: 0.04 });    // with rf rate
   ```

2. **Free helpers** exported from `src/metrics/index.ts` for callers who already have a NAV series and want to compute a single statistic without running a full simulation:

   ```typescript
   import { computeSharpe, computeDrawdownTable } from '@livefolio/sdk';
   ```

`SimulationHandle.metrics()` is synchronous and adds no runtime dependencies on storage, market, or strategy resolution.

## Types

```typescript
export interface MetricsOptions {
  riskFreeRate?: number;      // annualized decimal, default 0
  topDrawdowns?: number;      // default 5
  varConfidence?: number;     // default 0.95
}

export interface DrawdownEntry {
  peakDate: string;
  troughDate: string;
  recoveryDate: string | null;   // null = still underwater at series end
  depth: number;                  // negative decimal, e.g. -0.23
  durationDays: number;           // peak → recovery (or end-of-series if ongoing)
  underwaterDays: number;         // peak → trough
}

export interface MonthlyReturnsTable {
  rows: Array<{
    year: number;
    months: (number | null)[];   // length 12; null = month not fully covered
    ytd: number | null;          // null = no fully-covered month in this row
  }>;
}

export interface MetricsResult {
  range: { from: string; to: string; years: number };

  returns: {
    totalReturn: number;
    cagr: number;
    bestYear: { year: number; return: number } | null;
    worstYear: { year: number; return: number } | null;
    bestMonth: { date: string; return: number } | null;   // 'YYYY-MM'
    worstMonth: { date: string; return: number } | null;
    pctPositiveMonths: number;
  };

  risk: {
    volatility: number;          // annualized
    downsideDeviation: number;   // annualized, MAR=0
    maxDrawdown: DrawdownEntry;
    currentDrawdown: number;     // <= 0; 0 if at all-time high
    ulcerIndex: number;
    skew: number;                // sample (Fisher-Pearson)
    kurtosis: number;            // excess (sample)
    var95: number;               // positive loss magnitude, daily
    cvar95: number;              // positive loss magnitude, daily
  };

  riskAdjusted: {
    sharpe: number;
    sortino: number;
    calmar: number;
  };

  activity: {
    rebalances: number;
    trades: number;
    turnover: number;             // annualized two-way, decimal
    winRate: number;              // per-rebalance, [0,1]
  };

  tables: {
    drawdowns: DrawdownEntry[];   // length ≤ topDrawdowns, sorted by depth (most severe first)
    monthly: MonthlyReturnsTable;
    yearly: Array<{ year: number; return: number }>;
  };
}
```

## File Layout

New module under `src/metrics/`:

```
src/metrics/
  index.ts            # public exports (free helpers + types)
  types.ts            # MetricsResult, DrawdownEntry, MetricsOptions, MonthlyReturnsTable
  returns.ts          # daily returns; monthly / yearly bucketing
  summary.ts          # CAGR, totalReturn, best/worst year/month, %positive
  risk.ts             # volatility, downside deviation, skew, kurtosis, VaR, CVaR, Ulcer
  drawdown.ts         # max DD, current DD, top-N DD table
  riskAdjusted.ts     # Sharpe, Sortino, Calmar
  activity.ts         # rebalances, trades, turnover, win-rate-per-rebalance
  tables.ts           # monthly grid, yearly list
  compute.ts          # orchestrator: (series, trades, options) → MetricsResult
```

Each file has a co-located `*.test.ts` per the SDK's existing convention.

`SimulationHandle.metrics()` lives in `src/backtest/types.ts` (where the class already lives) and delegates to `compute.ts`. The `compute` module knows nothing about `SimulationHandle` — it takes plain `DailyBar[]` and `Trade[]`.

## Computation Details

### Returns

- **Daily returns**: `r_t = NAV_t / NAV_{t-1} − 1`. Length = `series.length − 1`.
- **Monthly bucketing**: last NAV of each calendar month. Monthly return = `last(month) / last(prevMonth) − 1`. Anchor the first comparison at the very first NAV, even if that month is partial — but flag the first and last months as "partial" if their first/last NAV doesn't fall on the actual month boundary, and exclude partial months from `bestMonth` / `worstMonth` / `pctPositiveMonths`.
- **Yearly bucketing**: same shape, calendar years.
- **CAGR**: `(NAV_end / NAV_start)^(1/years) − 1` where `years = (lastDateUTC − firstDateUTC) / 365.25` (days).
- **Total return**: `NAV_end / NAV_start − 1`.

### Risk

- **Annualized volatility**: sample stdev of daily returns × √252.
- **Downside deviation**: stdev of `min(0, r_t − MAR_daily)` where `MAR_daily = (1+rf)^(1/252) − 1`. Annualized × √252.
- **Skew**: Fisher–Pearson sample skewness, `(1/n) Σ ((r−μ)/σ)^3` adjusted with `n / ((n−1)(n−2))`.
- **Excess kurtosis**: sample excess kurtosis with the standard `n(n+1)/((n−1)(n−2)(n−3))` correction, minus `3(n−1)^2/((n−2)(n−3))`.
- **VaR / CVaR**: empirical, daily, no parametric assumption. `q = quantile(returns, 1 − confidence)`; `var = max(0, −q)`; `cvar = max(0, −mean(returns where r ≤ q))`.
- **Ulcer Index**: `√(mean(drawdown_t^2))` over the full series, where `drawdown_t = (NAV_t / runningMax_t − 1) × 100`. Reported as a number in percent units (testfol.io convention).
- **Current drawdown**: `(NAV_end / runningMax_end − 1)`. Always ≤ 0.

### Drawdown table

Single pass over the NAV series:

1. Track `runningMax` and the date it was set.
2. Track the open drawdown segment: `peakDate`, `troughDate`, `troughValue`.
3. On each bar:
   - If `NAV ≥ runningMax`: close the open segment with `recoveryDate = currentDate`, push it (if depth ≠ 0), and start tracking a fresh peak.
   - Else if `NAV < troughValue`: update `troughDate` and `troughValue`.
4. At end of series: if a segment is still open, push it with `recoveryDate = null` and `durationDays = lastDate − peakDate`.
5. Filter out segments with `|depth| < 1e-4` (avoid 1bp noise spam).
6. Sort descending by `|depth|`, take top `topDrawdowns`.

`maxDrawdown` is `drawdowns[0]` (or a synthetic zero-depth entry if the series never drew down — but in practice we throw if `series.length < 2`, and a single up-only series legitimately has a `0%` max DD entry covering the full range).

### Risk-adjusted

- **Sharpe**: `(mean(returns) − rf_daily) / stdev(returns) × √252`.
- **Sortino**: `(mean(returns) − rf_daily) / downsideStdev × √252`, where `downsideStdev` uses MAR = `rf_daily`.
- **Calmar**: `cagr / |maxDrawdown.depth|`. If max drawdown is 0, return `Infinity`.

### Activity

- **Rebalances**: `new Set(trades.map(t => t.date)).size`. Distinct trade dates.
- **Trades**: `trades.length`.
- **Turnover (annualized two-way)**:
  - `tradeValue_t = quantity × price` for each trade. Skip CASHX legs (funding, not exposure).
  - `grossTraded = Σ |tradeValue_t|`.
  - `avgNAV = mean(series.value)`.
  - `turnover = grossTraded / avgNAV / years`. Decimal (e.g. `2.4` = 240% annualized).
- **Win rate (per rebalance)**:
  - Boundaries = sorted distinct trade dates ∪ `{firstDate, lastDate}` (treat the period before the first rebalance and after the last as their own segments).
  - For each consecutive pair `(d_i, d_{i+1})`: segment return = `NAV_{d_{i+1}} / NAV_{d_i} − 1`.
  - `winRate = #{positive segments} / #{total segments}`. If the strategy never rebalances inside the date range, `winRate = 1` if total return > 0 else `0`.

### Tables

- **Drawdown table**: see drawdown algorithm above.
- **Monthly grid**: rows ordered ascending by year, months indexed `0..11` (Jan..Dec), `null` for months outside `[from, to]`. `ytd` = compounded return across non-null months in that row.
- **Yearly list**: one row per calendar year touched by `[from, to]`, including partial years. Return = compounded over fully-covered months in that year (partial months excluded).

## Edge Cases

- `series.length < 2`: throw `Error('metrics requires at least 2 daily bars')`. Strategies that never produced a full bar shouldn't reach this code path.
- Zero stdev of returns (constant NAV): `sharpe`, `sortino` = `NaN`. `volatility` = `0`.
- Series shorter than one full year: `cagr` is computed via fractional `years` (matches testfol.io).
- No trades at all: `rebalances = 0`, `trades = 0`, `turnover = 0`, `winRate` = `1` if total return > 0 else `0`.
- All-CASHX trade legs: still count toward `trades` but contribute 0 to turnover.
- Series ends underwater: `currentDrawdown < 0`; max-DD entry has `recoveryDate = null`.

## Conventions

- **Annualization**: fixed at 252 trading days for return-based stats, 365.25 calendar days for CAGR's denominator. Not configurable in v1.
- **Risk-free rate**: scalar, annualized decimal, default `0`. No `TickerHandle` form in v1.
- **Loss reporting**: VaR / CVaR returned as positive magnitudes. Drawdown depths reported as negatives (so `maxDrawdown.depth = −0.23` reads as "−23%").
- **Date math**: `daysBetween` uses UTC midnight diff (already a pattern in `src/backtest/simulate.ts:38`).
- **No mutation**: `metrics()` does not modify `simulation.series` or `simulation.trades`.

## Testing

Co-located `*.test.ts` per module:

- `returns.test.ts`: hand-built monthly/yearly bucketing on synthetic NAVs.
- `summary.test.ts`: CAGR / total-return arithmetic on a known 2-year series.
- `risk.test.ts`: skew/kurtosis against pen-and-paper values; VaR/CVaR on a 20-bar fixture; Ulcer on a constructed dip-recover series.
- `drawdown.test.ts`: constructed sequence (peak → −20% → recover → peak → −10% ongoing) verifies peak/trough/recovery dates, durations, and top-N ordering.
- `riskAdjusted.test.ts`: Sharpe/Sortino on a 10-bar series with a known mean and stdev; Calmar from constructed CAGR + maxDD.
- `activity.test.ts`: turnover and win-rate fixtures from fake `Trade[]` aligned with synthetic NAV bars; CASHX-only trades; zero-trade case.
- `tables.test.ts`: monthly grid layout (partial months as nulls, YTD compounding), yearly list (partial years).
- `compute.test.ts`: integration — runs the orchestrator on a fixture and asserts the full `MetricsResult` shape; one end-to-end test that runs `runSimulation` on a small strategy and checks `sim.metrics()` returns sensible numbers.

We are not testing against testfol.io's numbers; we test our own formulas. Conventions (especially Ulcer scaling and VaR sign) differ across vendors and that's fine.

## Public Exports

`src/index.ts` adds:

```typescript
export type {
  MetricsOptions,
  MetricsResult,
  DrawdownEntry,
  MonthlyReturnsTable,
} from './metrics';
export {
  computeMetrics,
  computeSharpe,
  computeSortino,
  computeDrawdownTable,
  computeMonthlyReturns,
  computeYearlyReturns,
} from './metrics';
```

`computeMetrics(series, trades, options?)` is the same orchestrator that `SimulationHandle.metrics()` calls — exposed for callers who don't have a simulation handle.

## Future Extensions (Not v1)

- Benchmark-relative stats: pass a `TickerHandle` or pre-fetched price series for beta/alpha/correlation/up-down capture.
- Per-position win rate via FIFO lot tracking on the trade log.
- Allocation-decomposition: per-leg contribution to return using `strategy.series()` (the day → allocation map) plus per-day prices.
- Risk-free rate as a `TickerHandle` (e.g. `^IRX`) so the rate varies through time.
- Configurable annualization basis (252 vs 365 vs custom).
- Rolling-window stats (rolling Sharpe, rolling drawdown).
