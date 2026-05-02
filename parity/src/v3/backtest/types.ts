import type { DailyBar } from '../handles/indicator';
import type { AllocationHandle } from '../handles/allocation';
import { PortfolioHandle } from '../handles/portfolio';
import type { TickerHandle } from '../handles/ticker';
import { computeMetrics } from '../metrics/compute';
import type { MetricsOptions, MetricsResult } from '../metrics/types';

export interface SimulateOptions {
  from: string;
  to: string;
  portfolio: PortfolioHandle;
}

export interface Trade {
  date: string;
  symbol: string;
  quantity: number;
  price: number;
  action: 'buy' | 'sell';
}

export interface PortfolioSnapshot {
  value: number;
  holdings: [TickerHandle, number][];
  weights: [TickerHandle, number][];
  pendingTrades: Trade[];
}

export interface FinalState {
  portfolio: PortfolioHandle;
  allocation: AllocationHandle;
  closePrices: Record<string, number>;
  leveragedPrices: Record<string, number>;
}

/** Per-signal slice of a live strategy snapshot. */
export interface LiveSignalState {
  indicator1: { value: number | null; date: string | null };
  indicator2: { value: number | null; date: string | null };
  isTrue: boolean;
}

/** Per-rule collection of live signal states, in the same order as the rule's `when` list. */
export interface LiveRuleState {
  signals: LiveSignalState[];
}

/** Full live strategy view for a single evaluation date — no portfolio info. */
export interface StrategyLiveState {
  allocation: AllocationHandle | null;
  activeRuleIndex: number;
  rules: LiveRuleState[];
}

/**
 * Combined live state returned by `SimulationHandle.pushAndPreview`: both the
 * portfolio snapshot from a `push` and the strategy evaluation at the target
 * date under the accumulated live-quote overrides.
 */
export interface LivePreviewState extends StrategyLiveState {
  snapshot: PortfolioSnapshot;
}

/**
 * Callback shape that `SimulationHandle.pushAndPreview` delegates to. Exists
 * purely to break the circular import between `SimulationHandle` (in this
 * file) and `StrategyHandle` (which creates simulations) — a strategy passes
 * a bound `(date, overrides) => previewLiveState(...)` into the handle.
 */
export interface LiveEvaluator {
  previewLiveState(date: string, overrides: Record<string, number>): Promise<StrategyLiveState>;
}

export class SimulationHandle {
  readonly series: DailyBar[];
  readonly trades: Trade[];
  readonly startingPortfolio: PortfolioHandle;

  private _portfolio: PortfolioHandle | null;
  private _currentAllocation: AllocationHandle | null;
  private _lastClosePrices: Record<string, number>;
  private _lastLeveragedPrices: Map<string, number>;
  private _currentLeveragedPrices: Map<string, number>;
  private _lastDate: string;
  private _pushedQuotes: Record<string, number>;
  private _liveEvaluator: LiveEvaluator | null;

  constructor(
    series: DailyBar[],
    trades: Trade[],
    startingPortfolio: PortfolioHandle,
    finalState?: FinalState,
    liveEvaluator?: LiveEvaluator,
  ) {
    this.series = series;
    this.trades = trades;
    this.startingPortfolio = startingPortfolio;

    if (finalState) {
      this._portfolio = finalState.portfolio;
      this._currentAllocation = finalState.allocation;
      this._lastClosePrices = finalState.closePrices;
      this._lastLeveragedPrices = new Map(Object.entries(finalState.leveragedPrices));
      this._currentLeveragedPrices = new Map(Object.entries(finalState.leveragedPrices));
      this._lastDate = series.at(-1)?.date ?? '';
    } else {
      this._portfolio = null;
      this._currentAllocation = null;
      this._lastClosePrices = {};
      this._lastLeveragedPrices = new Map();
      this._currentLeveragedPrices = new Map();
      this._lastDate = '';
    }

    this._pushedQuotes = {};
    this._liveEvaluator = liveEvaluator ?? null;
  }

  push(...prices: [TickerHandle, number][]): PortfolioSnapshot {
    if (!this._portfolio || !this._currentAllocation) {
      return { value: 0, holdings: [], weights: [], pendingTrades: [] };
    }

    // Update leveraged prices from raw market prices
    for (const [ticker, realPrice] of prices) {
      if (ticker.symbol === 'CASHX') continue;
      const lastClose = this._lastClosePrices[ticker.symbol];
      if (lastClose == null) continue;

      const realReturn = (realPrice - lastClose) / lastClose;

      // Apply leverage to all portfolio tickers sharing this symbol
      for (const [held] of this._portfolio.holdings) {
        if (held.symbol !== ticker.symbol) continue;
        if (held.symbol === 'CASHX') continue;
        const key = `${held.symbol}:${held.leverage}`;
        const baseLeveragedPrice = this._lastLeveragedPrices.get(key);
        if (baseLeveragedPrice == null) continue;
        const leveragedReturn = held.leverage * realReturn;
        this._currentLeveragedPrices.set(key, baseLeveragedPrice * (1 + leveragedReturn));
      }
    }

    // Build price array for PortfolioHandle methods
    const priceArray: [TickerHandle, number][] = [];
    for (const [held] of this._portfolio.holdings) {
      if (held.symbol === 'CASHX') continue;
      const key = `${held.symbol}:${held.leverage}`;
      const price = this._currentLeveragedPrices.get(key);
      if (price != null) priceArray.push([held, price]);
    }

    return {
      value: this._portfolio.value(priceArray),
      holdings: this._portfolio.holdings,
      weights: this._portfolio.weights(priceArray),
      pendingTrades: this._portfolio.trades(this._currentAllocation, priceArray, this._lastDate),
    };
  }

  /**
   * One-call live update. Feeds portfolio-relevant ticker prices into `push`
   * (derived from `quotes` via the running portfolio's holdings), accumulates
   * every symbol in `quotes` into an internal override map so macro symbols
   * (e.g. `^VIX`) persist across ticks, then delegates to the simulation's
   * strategy for rule / signal / indicator evaluation at `date`.
   *
   * Without a live evaluator attached, returns just the portfolio snapshot
   * with allocation/rules/signals empty.
   *
   * @param quotes Symbol → raw live price. Portfolio tickers flow through
   *   `push` for leveraged-equity math; non-portfolio symbols are still
   *   layered into the overlay so indicators can see them.
   * @param options.date Target trading day to evaluate against. Defaults to
   *   the current UTC ISO date; callers with non-UTC semantics or after-hours
   *   rollover should supply their own.
   */
  metrics(options: MetricsOptions = {}): MetricsResult {
    return computeMetrics(this.series, this.trades, options);
  }

  async pushAndPreview(quotes: Record<string, number>, options: { date?: string } = {}): Promise<LivePreviewState> {
    const priceArgs: [TickerHandle, number][] = [];
    if (this._portfolio) {
      const seen = new Set<string>();
      for (const [ticker] of this._portfolio.holdings) {
        if (ticker.symbol === 'CASHX') continue;
        if (seen.has(ticker.symbol)) continue;
        const price = quotes[ticker.symbol];
        if (price !== undefined) {
          priceArgs.push([ticker, price]);
          seen.add(ticker.symbol);
        }
      }
    }
    const snapshot = this.push(...priceArgs);

    // Merge into the running overlay map (macro symbols etc. persist across ticks).
    for (const [symbol, price] of Object.entries(quotes)) {
      this._pushedQuotes[symbol] = price;
    }

    if (!this._liveEvaluator) {
      return { snapshot, allocation: null, activeRuleIndex: -1, rules: [] };
    }

    const date = options.date ?? new Date().toISOString().slice(0, 10);
    // Pass a snapshot copy so downstream callers can retain the object without
    // seeing it mutate on later ticks.
    const strategyState = await this._liveEvaluator.previewLiveState(date, { ...this._pushedQuotes });
    return { snapshot, ...strategyState };
  }
}
