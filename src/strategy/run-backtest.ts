import type { Strategy, Features } from './types';
import type { Portfolio } from '../portfolio/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { Executor } from '../interfaces/executor';
import type { Calendar } from '../interfaces/calendar';
import type { FeatureCache } from '../interfaces/feature-cache';
import type { Asset, AssetId, Bar, DateRange, DividendEvent, Frequency } from '../interfaces/types';
import type { Order, Fill } from '../orders/types';
import type { FeatureRuntime } from '../features/runtime';
import { applyFills } from '../portfolio/apply';
import { distributeDividend, reinvestDividend } from '../tax/dividends';
import { accrueCashInterest } from '../tax/cash-interest';
import { findWashSales, applyWashSaleAdjustment } from '../tax/wash-sale';

/**
 * A scheduled cash injection or withdrawal. Applied at the start of the
 * matching session — BEFORE `universe`/`features`/`build` — by `runBacktest`
 * (see Task 10 wiring). Events with `t <= sessionT` that have not yet been
 * consumed are applied (and summed) on that session.
 */
export type CashEvent = {
  t: Date;
  /** Positive = deposit, negative = withdrawal. */
  delta: number;
  /**
   * Optional attribution tag for downstream metrics. `'deposit'`/`'withdrawal'`
   * are the natural tags for user-scheduled flows (this surface's main use case).
   * `'interest'`/`'dividend'` are accepted for callers who want to tag a
   * manually-scheduled flow as income, but the SDK's automatic per-session
   * interest/dividend hooks do NOT emit `CashEvent`s — they credit cash directly
   * and report via `BacktestSnapshot.interestIncome`/`dividendIncome`. User code
   * typically only sets `'deposit'`/`'withdrawal'`.
   */
  reason?: 'deposit' | 'withdrawal' | 'interest' | 'dividend';
};

/** How dividends are handled during a backtest. `reinvest: true` enables DRIP (dividend reinvestment). */
export type DividendsConfig = { reinvest: boolean };

/**
 * How idle cash earns interest during a backtest.
 * - `none` — cash earns nothing (default).
 * - `flat` — a constant annual percentage yield; daily rate is `apy / 365`.
 * - `tbill` — track a macro yield series (default `DGS3MO`) minus `spread`, as `(yield/100 - spread) / 365`.
 */
export type CashYieldConfig =
  | { kind: 'none' }
  | { kind: 'flat'; apy: number }
  | { kind: 'tbill'; spread: number; assetId?: AssetId };

/** Synthetic asset used to tag interest `RealizedEvent`s on idle cash. */
const CASH_ASSET: Asset = { kind: 'equity', id: '_cash', symbol: 'CASH' };

/**
 * Narrows the dual return type of `Strategy.build` to the stateful object form.
 *
 * `Array.isArray` does not narrow `ReadonlyArray<T>` out of a union in TypeScript 5.x
 * when the other arm is an object type, so we use an explicit type predicate instead.
 * The helper is defined at module scope so `runLive` (Task 8) can reuse it.
 */
export function isStateResult<S>(
  r: ReadonlyArray<Order> | { orders: ReadonlyArray<Order>; state: S },
): r is { orders: ReadonlyArray<Order>; state: S } {
  return !Array.isArray(r);
}

/** Lookback window (7 days) for the DRIP pay-date price fetch — see `firstUnadjustedClose`. */
const DRIP_PRICE_WINDOW_MS = 7 * 86_400_000;

/**
 * Fetches the first unadjusted bar's close on/after `payDate` from `feed`,
 * scanning a 7-day window starting at `payDate`. Used by DRIP to price the
 * reinvestment lot at the raw pay-date close. The window (rather than a single
 * day) tolerates pay dates that land on a non-trading day — the first bar
 * on/after `payDate` is used.
 *
 * @returns The close price, or `undefined` when no bar is available in the window.
 */
async function firstUnadjustedClose(
  feed: DataFeed,
  asset: Asset,
  payDate: Date,
  freq: Frequency,
): Promise<number | undefined> {
  const to = new Date(payDate.getTime() + DRIP_PRICE_WINDOW_MS);
  for await (const bar of feed.bars(asset, { from: payDate, to }, freq, 'unadjusted')) return bar.close;
  return undefined;
}

/**
 * Resolves the per-session interest rate for idle cash from a {@link CashYieldConfig}.
 *
 * - `none` / missing → `0` (no interest).
 * - `flat` → `apy / 365` (actual/365 day-count).
 * - `tbill` → fetches the macro yield series (default `DGS3MO`) over a short lookback
 *   window ending at `t`, takes the latest close (a FRED percentage), and returns
 *   `max(0, (yield/100 - spread) / 365)`.
 *
 * @returns A non-negative daily rate; `0` when no rate is configured or no bar is available.
 */
async function resolveDailyRate(
  cfg: CashYieldConfig | undefined,
  t: Date,
  feed: DataFeed,
  freq: Frequency,
): Promise<number> {
  if (!cfg || cfg.kind === 'none') return 0;
  if (cfg.kind === 'flat') return cfg.apy / 365;
  const id = cfg.assetId ?? 'DGS3MO';
  const asset: Asset = { kind: 'macro', id, symbol: id, source: 'FRED' };
  const to = new Date(t.getTime() + 86_400_000);
  let last: number | undefined;
  for await (const bar of feed.bars(asset, { from: new Date(t.getTime() - 7 * 86_400_000), to }, freq, 'unadjusted')) {
    last = bar.close;
  }
  if (last === undefined) return 0;
  return Math.max(0, (last / 100 - cfg.spread) / 365); // FRED yields are percentages
}

/**
 * All inputs required to run a historical backtest.
 *
 * Callers must provide a concrete `Strategy`, a `DateRange`, and the four
 * pluggable runtime layers (`dataFeed`, `executor`, `calendar`, `featureCache`).
 * The reference implementations (`MemoryFeatureCache`, `BacktestExecutor`,
 * `NYSEExchangeCalendar`) satisfy all four without network dependencies.
 */
export type RunBacktestOptions<F extends Features = Features, S = unknown> = {
  /** The strategy under test. Must implement `universe`, `features`, and `build`. */
  strategy: Strategy<F, S>;
  /**
   * Inclusive date range over which to iterate. The calendar resolves this
   * range into the actual sequence of trading sessions.
   */
  range: DateRange;
  /**
   * Starting portfolio state. Cash and positions are carried forward through
   * the simulation as orders are filled. This value is never mutated.
   */
  initialPortfolio: Portfolio;
  /**
   * Source of OHLCV bar data and optionally fundamentals / corporate events.
   * `FeatureRuntime` uses this to hydrate price series before computing indicators.
   */
  dataFeed: DataFeed;
  /**
   * Order router responsible for converting `Order` objects into `Fill` records.
   * Use `BacktestExecutor` for historical simulations or swap in a live
   * broker implementation for paper/live trading.
   */
  executor: Executor;
  /**
   * Trading-day calendar. Used to enumerate `sessions` within `range` and to
   * determine rebalance day boundaries via `next`.
   */
  calendar: Calendar;
  /**
   * Optional persistent indicator cache. When omitted, each `runBacktest` call
   * recomputes all indicators from scratch. Provide `MemoryFeatureCache` (or a
   * cross-process cache) to memoize results across multiple runs.
   */
  featureCache?: FeatureCache;
  /**
   * Bar frequency forwarded to `DataFeed.bars`. Defaults to `'1d'` when omitted.
   * Must match the granularity expected by the strategy's indicator specs.
   */
  freq?: Frequency;
  /**
   * Optional `FeatureRuntime` instance. When provided, its accumulated bar buffer
   * is exported on `BacktestResult.bars` for use by `runLive` (lets the streaming
   * runtime seed its buffer from the historical bars without refetching).
   */
  featureRuntime?: FeatureRuntime;
  /**
   * Optional scheduled deposits/withdrawals applied per-session before the
   * strategy runs. Matched by `t <= sessionT`; multiple due events are summed.
   * Defaults to none (today's behavior). See `BacktestSnapshot.cashFlow`.
   *
   * @remarks A withdrawal that exceeds available cash is allowed to drive cash
   * negative (logged via `console.warn`); automatic force-selling of holdings to
   * fund withdrawals is deferred to a later release, so this behavior may change.
   */
  cashEvents?: ReadonlyArray<CashEvent>;
  /**
   * Optional dividend handling. When `dataFeed.dividends` exists, the universe's
   * day-0 dividends are pre-fetched and dividends are applied to held lots on the
   * first session on/after their `exDate`: cash mode credits cash, DRIP mode
   * (`reinvest: true`) reinvests into a new lot at the unadjusted pay-date close.
   *
   * @remarks Default = no dividends applied unless `dataFeed.dividends` exists;
   * `reinvest` defaults to `false` (cash mode).
   * @remarks Static-universe assumption: dividends are queried once for the day-0
   * universe (`strategy.universe(sessions[0], initialPortfolio)`). Assets that
   * enter the universe on later sessions — e.g. a dynamic-universe strategy that
   * opens a new position mid-run — will NOT have their dividends applied. This is
   * a non-issue for `fromSpec` strategies, whose universe is statically declared.
   */
  dividends?: DividendsConfig;
  /**
   * Optional idle-cash interest accrual. Each session — after dividends, before
   * the strategy runs — interest is accrued on positive cash at a daily rate
   * resolved from this config (`flat` → `apy/365`; `tbill` → macro yield series
   * `(yield/100 - spread)/365`, clamped ≥ 0). The interest is credited to cash,
   * recorded as an `interest` `RealizedEvent` on the synthetic cash asset, and
   * reported via `BacktestSnapshot.interestIncome`.
   *
   * @remarks Default = `{ kind: 'none' }` (no interest → today's behavior).
   */
  cashYield?: CashYieldConfig;
};

/**
 * A point-in-time snapshot of the simulation at the end of a single trading session.
 *
 * Each entry in `BacktestResult.snapshots` corresponds to one call of the strategy
 * loop: `universe → features → build → executor.submit → applyFills`.
 */
export type BacktestSnapshot = {
  /** The session date for this snapshot (midnight UTC on the trading day). */
  t: Date;
  /** Portfolio state *after* fills have been applied for this session. */
  portfolio: Portfolio;
  /** Orders emitted by `strategy.build` during this session. */
  orders: ReadonlyArray<Order>;
  /** Fills returned by the executor for the orders above. */
  fills: ReadonlyArray<Fill>;
  /**
   * Net cash delta applied this session via `cashEvents`. Omitted when zero.
   */
  cashFlow?: number;
  /** Dividend income recognized this session, split by qualified status. Omitted when zero. */
  dividendIncome?: { qualified: number; ordinary: number };
  /** Interest income accrued on cash this session. Omitted when zero. */
  interestIncome?: number;
};

/**
 * The return value of `runBacktest`, containing the full simulation history
 * and the terminal portfolio state.
 */
export type BacktestResult<S = unknown> = {
  /**
   * Ordered list of snapshots, one per trading session in `range`. Empty when
   * the calendar has no sessions in the requested range.
   */
  snapshots: ReadonlyArray<BacktestSnapshot>;
  /**
   * Portfolio after the last session's fills have been applied. Equivalent to
   * `snapshots[snapshots.length - 1].portfolio` when there is at least one session,
   * or `initialPortfolio` when the range is empty.
   */
  finalPortfolio: Portfolio;
  /**
   * Final value of the strategy's auxiliary state after the last `build()` call.
   * `undefined` when the strategy is state-less (no `initialState()` defined).
   * Used by `runLive` to seed the live runtime so the first live tick continues
   * from the exact state the historical run ended on.
   */
  finalState: S | undefined;
  /**
   * Per-asset bar buffer accumulated by the `FeatureRuntime` during this run.
   * Empty `Map` when no `featureRuntime` was provided in `RunBacktestOptions`.
   * Used by `runLive` to seed its streaming `FeatureRuntime` so indicators with
   * warmup periods (SMA(200), etc.) work on the first live tick.
   */
  bars: ReadonlyMap<AssetId, ReadonlyArray<Bar>>;
};

/**
 * Drives a `Strategy` over a historical date range and returns a full audit trail
 * of orders, fills, and portfolio states.
 *
 * The simulation loop:
 * 1. Enumerate trading sessions via `opts.calendar.sessions(opts.range)`.
 * 2. Call `strategy.initialState?.()` once to seed the carry-over state.
 * 3. For each session `t`, call `strategy.universe(t, portfolio)`.
 * 4. Await `strategy.features(universe, portfolio, t)`.
 * 5. Call `strategy.build(features, portfolio, state, t)` to obtain orders and
 *    the next state value. Both legacy `Order[]` returns and new `{ orders, state }`
 *    returns are normalised — the legacy form leaves state unchanged.
 * 6. Await `opts.executor.submit(orders, t, portfolio)` to obtain fills.
 * 7. Apply fills to the portfolio with `applyFills`.
 * 8. Append a `BacktestSnapshot` and advance to the next session.
 *
 * At each calendar-year boundary (and once more at end-of-run) a wash-sale sweep
 * (IRS §1091) marks the closing year's disallowed capital losses and rolls them
 * into the replacement lot's basis. The sweep is idempotent and finalized at
 * those boundaries: it is reflected on `finalPortfolio` and any later snapshot,
 * but is NOT retroactively rewritten into snapshots already pushed for the
 * closing year.
 *
 * The portfolio is never mutated in place; each session receives the immutable
 * result of the previous session's `applyFills`.
 *
 * @param opts - Backtest configuration. See {@link RunBacktestOptions}.
 * @returns A promise that resolves to a {@link BacktestResult} containing one
 *   snapshot per trading session, the final portfolio state, and the final
 *   strategy state (`finalState`). Returns
 *   `{ snapshots: [], finalPortfolio: opts.initialPortfolio, finalState: undefined }`
 *   when the calendar has no sessions in the requested range.
 *
 * @example
 * ```ts
 * import {
 *   runBacktest,
 *   fromSpec,
 *   MemoryFeatureCache,
 *   BacktestExecutor,
 *   NYSEExchangeCalendar,
 *   FeatureRuntime,
 * } from '@livefolio/sdk';
 *
 * const calendar = new NYSEExchangeCalendar();
 * const range = { from: new Date('2023-01-01'), to: new Date('2023-12-31') };
 * const featureCache = new MemoryFeatureCache();
 * const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });
 *
 * const strategy = fromSpec(myTacticalSpec, { runtime, calendar });
 *
 * const result = await runBacktest({
 *   strategy,
 *   range,
 *   initialPortfolio: { cash: 100_000, positions: [] },
 *   dataFeed,
 *   executor: new BacktestExecutor({ dataFeed }),
 *   calendar,
 *   featureCache,
 *   freq: '1d',
 * });
 *
 * console.log(result.finalPortfolio.cash);
 * console.log(result.snapshots.length); // one entry per NYSE trading day in 2023
 * ```
 */
export async function runBacktest<F extends Features = Features, S = unknown>(
  opts: RunBacktestOptions<F, S>,
): Promise<BacktestResult<S>> {
  const initialStateValue: S | undefined = opts.strategy.initialState?.();
  const sessions = opts.calendar.sessions(opts.range);
  if (sessions.length === 0) {
    return {
      snapshots: [],
      finalPortfolio: opts.initialPortfolio,
      finalState: initialStateValue,
      bars: opts.featureRuntime?.getAllBars() ?? new Map<AssetId, ReadonlyArray<Bar>>(),
    };
  }

  let portfolio = opts.initialPortfolio;
  let state: S | undefined = initialStateValue;
  const snapshots: BacktestSnapshot[] = [];

  // Wash-sale sweep (IRS §1091): at each calendar-year boundary and at end-of-run, mark the
  // closing year's unmarked capital losses that have a same-asset replacement lot opened within
  // ±30 days, and roll the disallowed loss into that replacement lot's basis. Idempotent — events
  // already carrying `washSaleDisallowed` are skipped, so basis is never bumped twice.
  //
  // Marking is FINALIZED at year/run boundaries and reflected on `finalPortfolio` and any snapshot
  // pushed after the sweep — it is NOT retroactively rewritten into snapshots already pushed for the
  // closing year (each of those holds a reference to the pre-sweep `portfolio`).
  const runWashSaleSweep = (year: number): void => {
    const losses = (portfolio.realized ?? []).filter(
      (e) =>
        e.closeDate.getUTCFullYear() === year &&
        e.incomeKind === 'capital-gain' &&
        e.gain < 0 &&
        e.washSaleDisallowed === undefined,
    );
    const adjustments = findWashSales(losses, portfolio.lots ?? []);
    if (adjustments.length === 0) return;
    let lots = [...(portfolio.lots ?? [])];
    const byLossLot = new Map(adjustments.map((a) => [a.lossEventLotId, a]));
    const realized = (portfolio.realized ?? []).map((e) => {
      const a = byLossLot.get(e.lotId);
      return a && e.washSaleDisallowed === undefined && e.gain < 0
        ? { ...e, washSaleDisallowed: a.disallowedAmount }
        : e;
    });
    for (const a of adjustments) lots = applyWashSaleAdjustment(lots, a);
    portfolio = { ...portfolio, lots, realized };
  };
  let prevYear = -1;

  const cashEvents = [...(opts.cashEvents ?? [])].sort((a, b) => a.t.getTime() - b.t.getTime());
  let eventCursor = 0;
  // Negative cash is allowed for now (force-sell on over-withdrawal is deferred);
  // warn once per run so a withdrawal-heavy strategy doesn't spam the logs.
  let warnedNegativeCash = false;
  // Warn once per run when DRIP is requested but a pay-date price was unavailable
  // and the dividend fell back to a cash credit (see the dividend drain below).
  let warnedDripFallback = false;

  // Pre-fetch dividends ONCE for the day-0 universe. Static-universe assumption:
  // assets that enter the universe on later sessions will NOT have their dividends
  // applied — only the day-0 universe is queried. This keeps the hook O(1) per
  // session (no per-session feed calls) at the cost of not tracking universe churn.
  const divByAsset = new Map<string, DividendEvent[]>();
  if (opts.dataFeed.dividends && sessions.length > 0) {
    const u0 = opts.strategy.universe(sessions[0]!, opts.initialPortfolio);
    for (const asset of u0) {
      divByAsset.set(asset.id, await opts.dataFeed.dividends(asset, opts.range));
    }
  }
  // Flatten and sort ascending by exDate so a monotonic cursor can drain per session.
  const allDivs = [...divByAsset.values()]
    .flat()
    .sort((a, b) => a.exDate.getTime() - b.exDate.getTime());
  let divCursor = 0;

  for (const t of sessions) {
    const sessionYear = t.getUTCFullYear();
    if (prevYear >= 0 && sessionYear !== prevYear) runWashSaleSweep(prevYear);
    prevYear = sessionYear;

    let cashFlow = 0;
    while (
      eventCursor < cashEvents.length &&
      cashEvents[eventCursor]!.t.getTime() <= t.getTime()
    ) {
      cashFlow += cashEvents[eventCursor]!.delta;
      eventCursor++;
    }
    if (cashFlow !== 0) {
      portfolio = { ...portfolio, cash: portfolio.cash + cashFlow };
      if (portfolio.cash < 0 && !warnedNegativeCash) {
        warnedNegativeCash = true;
        console.warn(
          `[runBacktest] cash went negative at ${t.toISOString()}: ${portfolio.cash}. ` +
            `Withdrawals exceed available cash (force-sell is deferred); further occurrences this run are suppressed.`,
        );
      }
    }

    // Drain every dividend with exDate on or before this session that hasn't been applied yet
    // (cursor pattern; allDivs is sorted by exDate, so this is O(1) amortized — no per-session scan).
    // A dividend whose exDate landed on a non-trading day (weekend/holiday, between two sessions) is
    // rolled forward to the first session on/after its exDate rather than silently dropped — no
    // session occurs between the ex-date and here, so the entitled lot is still held. Lot eligibility
    // is keyed off the dividend's own exDate inside distributeDividend, not the (possibly later) `t`.
    let qualifiedTotal = 0;
    let ordinaryTotal = 0;
    while (divCursor < allDivs.length && allDivs[divCursor]!.exDate.getTime() <= t.getTime()) {
      const div = allDivs[divCursor]!;
      divCursor++;
      const dist = distributeDividend(div, portfolio.lots ?? []);
      if (dist.perLot.length === 0) continue;
      qualifiedTotal += dist.totals.qualified;
      ordinaryTotal += dist.totals.ordinary;
      const reinvest = opts.dividends?.reinvest === true;
      const lots = [...(portfolio.lots ?? [])];
      const realized = [...(portfolio.realized ?? [])];
      let cashCredit = 0;
      // DRIP reinvests at the unadjusted pay-date close, which is identical for every slice of
      // this dividend (same asset, same pay date) — fetch it once per dividend, not once per lot.
      const reinvestPrice = reinvest
        ? await firstUnadjustedClose(opts.dataFeed, div.asset, div.payDate, opts.freq ?? '1d')
        : undefined;
      for (const slice of dist.perLot) {
        realized.push({
          asset: div.asset,
          lotId: slice.lotId,
          quantity: 0,
          openDate: t,
          closeDate: t,
          proceeds: slice.cash,
          basis: 0,
          termType: 'long',
          gain: slice.cash,
          incomeKind: slice.qualified ? 'qualified-dividend' : 'ordinary-dividend',
        });
        if (reinvest && reinvestPrice && reinvestPrice > 0) {
          const { newLot, residual } = reinvestDividend(slice.cash, div.asset, reinvestPrice, div.payDate, slice.lotId);
          if (newLot.quantity > 0) lots.push(newLot);
          cashCredit += residual;
        } else {
          // Cash mode, or DRIP with no/zero pay-date price → credit the full slice to cash.
          if (reinvest && !warnedDripFallback) {
            warnedDripFallback = true;
            console.warn(
              `[runBacktest] DRIP fell back to a cash credit for ${div.asset.id} (pay date ` +
                `${div.payDate.toISOString()}): no unadjusted bar within 7 days of the pay date. ` +
                `Further occurrences this run are suppressed.`,
            );
          }
          cashCredit += slice.cash;
        }
      }
      portfolio = { ...portfolio, cash: portfolio.cash + cashCredit, lots, realized };
    }
    const dividendIncome =
      qualifiedTotal + ordinaryTotal > 0 ? { qualified: qualifiedTotal, ordinary: ordinaryTotal } : undefined;

    let interestThisSession = 0;
    const dailyRate = await resolveDailyRate(opts.cashYield, t, opts.dataFeed, opts.freq ?? '1d');
    if (dailyRate > 0 && portfolio.cash > 0) {
      const { newCash, interest } = accrueCashInterest(portfolio.cash, dailyRate);
      const realized = [
        ...(portfolio.realized ?? []),
        {
          asset: CASH_ASSET,
          lotId: 'cash',
          quantity: 0,
          openDate: t,
          closeDate: t,
          proceeds: interest,
          basis: 0,
          termType: 'short' as const,
          gain: interest,
          incomeKind: 'interest' as const,
        },
      ];
      portfolio = { ...portfolio, cash: newCash, realized };
      interestThisSession = interest;
    }

    const universe = opts.strategy.universe(t, portfolio);
    const features = await opts.strategy.features(universe, portfolio, t);
    const buildResult = opts.strategy.build(features, portfolio, state as S, t);

    let orders: ReadonlyArray<Order>;
    if (isStateResult(buildResult)) {
      orders = buildResult.orders;
      state = buildResult.state;
    } else {
      // Legacy state-less return shape — state unchanged.
      orders = buildResult;
    }

    const fills = await opts.executor.submit(orders, t, portfolio);
    portfolio = applyFills(portfolio, fills, orders);
    snapshots.push({
      t,
      portfolio,
      orders,
      fills,
      ...(cashFlow !== 0 ? { cashFlow } : {}),
      ...(dividendIncome ? { dividendIncome } : {}),
      ...(interestThisSession !== 0 ? { interestIncome: interestThisSession } : {}),
    });
  }

  if (prevYear >= 0) runWashSaleSweep(prevYear);

  const bars = opts.featureRuntime?.getAllBars() ?? new Map<AssetId, ReadonlyArray<Bar>>();
  return { snapshots, finalPortfolio: portfolio, finalState: state, bars };
}
