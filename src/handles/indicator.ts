import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';
import type { IndicatorType, Unit } from '../providers/types';
import { TickerHandle } from './ticker';
import { getProviderInfo, isRateTickerSymbol } from '../providers/mappings';
import { getComputation } from '../computations/index';
import { computeReturns } from '../computations/returns';
import { computeCalendar } from '../computations/calendar';

/**
 * Inverse of `FRED_SERIES` in `providers/mappings.ts`. Lets `_readStoredBars`
 * map a FRED series ID (`DGS3MO`, `DGS10`, etc.) back to the indicator type
 * whose stored series holds that series' history.
 */
const FRED_SYMBOL_TO_TYPE: Record<string, string> = {
  DGS3MO: 'T3M',
  DGS6MO: 'T6M',
  DGS1: 'T1Y',
  DGS2: 'T2Y',
  DGS3: 'T3Y',
  DGS5: 'T5Y',
  DGS7: 'T7Y',
  DGS10: 'T10Y',
  DGS20: 'T20Y',
  DGS30: 'T30Y',
};

/**
 * Subtract `days` calendar days from an ISO date string (YYYY-MM-DD).
 * Used to compute a `from` cutoff for bounded bar fetches in `computeAt`.
 */
function _subtractCalendarDays(date: string, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export interface DailyBar {
  date: string;
  value: number;
}

export interface IndicatorIdentity {
  type: IndicatorType;
  ticker: TickerHandle | null;
  lookback: number;
  delay: number;
  unit: Unit | null;
  threshold: number | null;
}

export interface DateRange {
  from?: string;
  to?: string;
}

export class IndicatorHandle {
  readonly type: IndicatorType;
  readonly ticker: TickerHandle | null;
  readonly lookback: number;
  readonly delay: number;
  readonly unit: Unit | null;
  readonly threshold: number | null;

  private _storage: StorageProvider;
  private _market: MarketProvider;
  private _resolvedId: number | null = null;
  private _resolving: Promise<{ id: number }> | null = null;

  private _cachedSeries: DailyBar[] | null = null;
  private _cachedAsOf: string | null = null;
  private _syncing: Promise<void> | null = null;

  constructor(storage: StorageProvider, market: MarketProvider, identity: IndicatorIdentity) {
    this._storage = storage;
    this._market = market;
    this.type = identity.type;
    this.ticker = identity.ticker;
    this.lookback = identity.lookback;
    this.delay = identity.delay;
    this.unit = identity.unit;
    this.threshold = identity.threshold;
  }

  get id(): number {
    if (this._resolvedId == null)
      throw new Error('IndicatorHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolvedId;
  }

  async resolve(): Promise<{ id: number }> {
    if (this._resolvedId != null) return { id: this._resolvedId };
    if (!this._resolving) this._resolving = this._doResolve();
    return this._resolving;
  }

  static fromResolved(
    storage: StorageProvider,
    market: MarketProvider,
    id: number,
    identity: IndicatorIdentity,
  ): IndicatorHandle {
    const handle = new IndicatorHandle(storage, market, identity);
    handle._resolvedId = id;
    return handle;
  }

  private async _doResolve(): Promise<{ id: number }> {
    const tickerId = this.ticker ? (await this.ticker.resolve()).id : null;
    const result = await this._storage.indicators.findOrCreate({
      type: this.type,
      tickerId,
      lookback: this.lookback,
      delay: this.delay,
      unit: this.unit,
      threshold: this.threshold,
    });
    this._resolvedId = result.id;
    return result;
  }

  // ── Freshness & Sync ───────────────────────────────────────────────

  private async _getLatestClosedTradingDay(): Promise<string> {
    const date = await this._storage.tradingDays.getLatestClosed();
    if (!date) throw new Error('No closed trading days found');
    return date;
  }

  private async _getLatestSeriesDate(indicatorId: number): Promise<string | null> {
    return this._storage.indicators.getLatestSeriesDate(indicatorId);
  }

  private async _ensureFresh(): Promise<void> {
    const { id } = await this.resolve();
    const latestClosed = await this._getLatestClosedTradingDay();

    // In-memory cache still valid
    if (this._cachedAsOf === latestClosed) return;

    const latestSeries = await this._getLatestSeriesDate(id);

    if (latestSeries === latestClosed) {
      // DB is fresh — invalidate in-memory cache so next read picks up DB data
      this._cachedSeries = null;
      this._cachedAsOf = latestClosed;
      return;
    }

    // Need to sync — deduplicate concurrent calls. On sync failure (e.g.,
    // browser has no market provider, or upstream feed hasn't published the
    // new date yet), fall back to whatever storage already has and treat the
    // cache as fresh so downstream callers don't retry the failing sync on
    // every read.
    if (!this._syncing) {
      this._syncing = this._sync(latestSeries ?? undefined, latestClosed)
        .catch((err) => {
          console.warn('[sdk] indicator sync failed, using stored data:', err);
        })
        .finally(() => {
          this._syncing = null;
        });
    }
    await this._syncing;

    this._cachedSeries = null;
    this._cachedAsOf = latestClosed;
  }

  private async _sync(fromDate: string | undefined, latestClosed: string): Promise<void> {
    const tickerSymbol = this.ticker?.symbol ?? null;
    const info = getProviderInfo(this.type, tickerSymbol);

    let bars: DailyBar[];

    switch (info.provider) {
      case 'yahoo':
        bars = await this._market.fetchBars(info.symbol, fromDate);
        break;

      case 'fred':
        bars = await this._market.fetchBars(info.seriesId, fromDate);
        break;

      case 'computed': {
        // Create an internal Price handle for the same ticker
        const priceHandle = new IndicatorHandle(this._storage, this._market, {
          type: 'Price',
          ticker: this.ticker,
          lookback: 0,
          delay: 0,
          unit: null,
          threshold: null,
        });

        // Recursively ensure Price data is fresh
        await priceHandle._ensureFresh();

        // Read Price series from DB
        const priceBars = await priceHandle._querySeriesFromDb();

        if (this.type === 'Return') {
          // For rate/yield series (e.g. DTB3, DFF), percentage change is broken
          // near zero and semantically wrong; use absolute differences instead.
          bars = computeReturns(priceBars, this.lookback, info.rateSeries ? 'abs' : 'pct');
        } else {
          const computeFn = getComputation(this.type);
          if (!computeFn) throw new Error(`No computation found for type "${this.type}"`);
          bars = computeFn(priceBars, this.lookback);
        }

        // If incremental, filter to only new bars
        if (fromDate) {
          bars = bars.filter((b) => b.date > fromDate);
        }
        break;
      }

      case 'calendar': {
        // Fetch all trading days to compute calendar values
        const allDays = await this._storage.tradingDays.getRange();
        const dayBars: DailyBar[] = allDays.map((date) => ({ date, value: 0 }));
        bars = computeCalendar(dayBars, this.type as 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year');

        if (fromDate) {
          bars = bars.filter((b) => b.date > fromDate);
        }
        break;
      }

      case 'none':
        // Threshold indicators have no series to sync
        return;
    }

    // Apply leverage to daily returns only for fetched (non-computed) indicators.
    // Computed indicators (RSI, SMA, etc.) already read from the leveraged price series.
    if (info.provider !== 'computed') {
      bars = await this._applyLeverage(bars, fromDate);
    }

    // Filter bars up to latestClosed
    bars = bars.filter((b) => b.date <= latestClosed);

    if (bars.length > 0) {
      await this._upsertSeries(bars);
    }
  }

  private async _upsertSeries(bars: DailyBar[]): Promise<void> {
    const { id } = await this.resolve();
    await this._storage.indicators.writeSeries(id, bars);
  }

  private async _querySeriesFromDb(range?: DateRange): Promise<DailyBar[]> {
    const { id } = await this.resolve();
    return this._storage.indicators.getSeries(id, range);
  }

  /**
   * Apply leverage compounding to a raw bar series, anchored to a stored
   * leveraged value. Used by both `_sync` and `computeAt` so they stay
   * consistent.
   *
   * `anchorDate` is the date of the last *already-stored* leveraged bar
   * (i.e., the bar just before `rawBars[0]`). The stored leveraged value
   * at that date becomes `leveraged[0]`; raw returns are then compounded
   * forward for each subsequent bar.
   *
   * If no stored anchor exists (first-ever sync), falls back to rawBars[0]
   * as the starting raw value — identical to `_sync`'s behaviour.
   */
  private async _applyLeverage(rawBars: DailyBar[], anchorDate: string | undefined): Promise<DailyBar[]> {
    const leverage = this.ticker?.leverage ?? 1;
    if (leverage === 1 || rawBars.length === 0) return rawBars;
    // Rate tickers (DTB3, DFF, etc.) skip leverage compounding: the stored series
    // stays raw; the simulator applies the leverage multiplier at accrual time.
    if (isRateTickerSymbol(this.ticker?.symbol ?? null)) return rawBars;

    let anchor: number;
    if (anchorDate) {
      const lastStored = await this._storage.indicators.getValue(this._resolvedId!, anchorDate);
      anchor = lastStored ?? rawBars[0]!.value;
    } else {
      anchor = rawBars[0]!.value;
    }

    const leveraged: DailyBar[] = [{ date: rawBars[0]!.date, value: anchor }];
    for (let i = 1; i < rawBars.length; i++) {
      const dailyReturn = (rawBars[i]!.value - rawBars[i - 1]!.value) / rawBars[i - 1]!.value;
      const prev = leveraged[i - 1]!.value;
      leveraged.push({ date: rawBars[i]!.date, value: prev * (1 + leverage * dailyReturn) });
    }
    return leveraged;
  }

  /**
   * Compute the indicator's value at `date` without persisting anything, with
   * optional live-quote `overrides` keyed by raw market symbol (the same symbol
   * space `MarketProvider.fetchBars` uses — ticker symbols for Price/SMA/etc.,
   * `^VIX` / `^VIX3M` for macro, FRED series IDs like `DGS3MO` for Treasury).
   *
   * Bars for the underlying symbol are resolved storage-first when the market
   * hasn't yet produced bars for `date` (trading day still open), and storage
   * is the fallback whenever the remote fetch fails — see `_resolveRawBars`.
   *
   * For Threshold: returns the threshold constant. For calendar types: computed
   * from `tradingDays.getRange()`. For all others: `_resolveRawBars` → leverage
   * compounding (if any) → lookback-specific computation. Returns null if the
   * value cannot be computed.
   */
  async computeAt(date: string, overrides?: Record<string, number>): Promise<number | null> {
    // Threshold is a special case: it has no market data, just a constant value.
    if (this.type === 'Threshold') return this.threshold;

    const tickerSymbol = this.ticker?.symbol ?? null;
    const info = getProviderInfo(this.type, tickerSymbol);

    if (info.provider === 'none') return null;

    if (info.provider === 'calendar') {
      const allDays = await this._storage.tradingDays.getRange();
      const dayBars: DailyBar[] = allDays.map((d) => ({ date: d, value: 0 }));
      const computed = computeCalendar(dayBars, this.type as 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year');
      return computed.find((b) => b.date === date)?.value ?? null;
    }

    if (info.provider === 'computed') {
      // Size the bar window by the computation's actual needs, expressed in
      // calendar days. Three buckets:
      //
      //   Exact reads (SMA / Return / Volatility / Drawdown) want `lookback`
      //   *trading* days in the result; with ~5 trading days per 7 calendar
      //   days plus holidays that's ~`lookback * 1.5` calendar days, plus a
      //   small fixed buffer for long weekends.
      //
      //   EMA is recursive: seed = first N-bar SMA, then `(1-α)^k` decay with
      //   α = 2 / (N+1). For small N the decay is fast; for N=200 decay is
      //   ~0.99/bar, so we want several multiples of `lookback` to get close
      //   to the fully-synced EMA value.
      //
      //   Wilder's RSI decays at ~10%/bar regardless of lookback and starts
      //   from a simple-average seed that can pin at 100 (or 0) for a window
      //   full of only-up (or only-down) days; it needs the widest window.
      let calendarDays: number;
      if (this.type === 'RSI') {
        calendarDays = Math.max(this.lookback * 10, 90);
      } else if (this.type === 'EMA') {
        calendarDays = Math.max(this.lookback * 5, 60);
      } else {
        // SMA, Return, Volatility, Drawdown — exact-read, only need coverage.
        calendarDays = Math.ceil(this.lookback * 1.5) + 15;
      }
      const from = _subtractCalendarDays(date, this.lookback + calendarDays);
      const rawBars = await this._resolveRawBars(info.symbol, from, date, overrides);

      // Apply leverage anchored to the stored leveraged value at the date just
      // before the first resolved raw bar. Mirrors `_sync`'s anchor logic.
      const anchorDate = rawBars.length > 0 ? rawBars[0]!.date : undefined;
      const priceBars = await this._applyLeverage(rawBars, anchorDate);

      const computeFn = getComputation(this.type);
      if (!computeFn) throw new Error(`No computation found for type "${this.type}"`);
      const computed = computeFn(priceBars, this.lookback);
      return computed.find((b) => b.date === date)?.value ?? null;
    }

    // yahoo or fred: resolve a small window — just enough to get `date` and
    // one prior bar (needed for leverage return calculation). 15 calendar days
    // comfortably bridges a long weekend + holiday gap; FRED series in
    // particular publish on T+1 / T+2 cadences and can miss a market day.
    const symbol = info.provider === 'yahoo' ? info.symbol : info.seriesId;
    const from = _subtractCalendarDays(date, 15);
    const rawBars = await this._resolveRawBars(symbol, from, date, overrides);

    const leverage = this.ticker?.leverage ?? 1;
    if (leverage === 1) {
      return rawBars.find((b) => b.date === date)?.value ?? null;
    }

    // Apply leverage compounding.
    const dateIdx = rawBars.findIndex((b) => b.date === date);
    if (dateIdx < 0) return null; // date not in bars at all

    const prevBar = rawBars[dateIdx - 1];
    if (!prevBar) {
      // No previous bar in the window — can't compound. Return raw value as fallback.
      return rawBars[dateIdx]!.value;
    }

    const storedPrev = await this._storage.indicators.getValue(this._resolvedId!, prevBar.date);
    const leveragedPrev = storedPrev ?? prevBar.value;
    const rawReturn = (rawBars[dateIdx]!.value - prevBar.value) / prevBar.value;
    return leveragedPrev * (1 + leverage * rawReturn);
  }

  /**
   * Raw (unleveraged) bars for `symbol` up through `date`, with the live quote
   * from `overrides[symbol]` (if any) spliced in at `date`.
   *
   * Decision policy:
   *   - `date` > `tradingDays.getLatestClosed()`: market has nothing for that
   *     day yet — skip the remote fetch entirely and read from storage.
   *   - otherwise: try `this._market.fetchBars(symbol, from)`. On failure, fall
   *     back to storage — upstream HTTP providers (Yahoo / FRED) are flaky.
   *
   * After the base is resolved, `overrides[symbol]` is spliced at `date`
   * (replaces the existing bar, or is appended in-order). When no override is
   * present but `date` isn't in the base bars, the last known value is carried
   * forward to `date` — this preserves the fallbackMissingQuotes behaviour the
   * old overlay exposed so leverage compounding / computations always have a
   * point at `date` to land on.
   */
  private async _resolveRawBars(
    symbol: string,
    from: string,
    date: string,
    overrides?: Record<string, number>,
  ): Promise<DailyBar[]> {
    const latestClosed = await this._storage.tradingDays.getLatestClosed();
    const closedForDate = latestClosed !== null && date <= latestClosed;

    let bars: DailyBar[];
    if (closedForDate) {
      try {
        bars = await this._market.fetchBars(symbol, from);
      } catch {
        bars = await this._readStoredBars(symbol, from);
      }
    } else {
      bars = await this._readStoredBars(symbol, from);
    }

    const override = overrides?.[symbol];
    const existingIdx = bars.findIndex((b) => b.date === date);

    if (override !== undefined) {
      if (existingIdx >= 0) {
        bars[existingIdx] = { date, value: override };
      } else {
        bars = [...bars, { date, value: override }].sort((a, b) => a.date.localeCompare(b.date));
      }
    } else if (existingIdx < 0 && bars.length > 0) {
      // Carry last known value forward to `date` (matches the overlay's
      // `fallbackMissingQuotes` behaviour for every consumer that used it).
      bars = [...bars, { date, value: bars[bars.length - 1]!.value }];
    }

    return bars;
  }

  /**
   * Resolve raw (unleveraged) bars for a market symbol from storage. Maps:
   *   - `^VIX`   → the VIX indicator's stored series
   *   - `^VIX3M` → the VIX3M indicator's stored series
   *   - `DGS*`   → the matching Treasury-tenor indicator's stored series
   *   - anything else → the `Price` indicator for that ticker symbol with
   *     `leverage = 1` (the raw contract that `MarketProvider.fetchBars` has).
   *
   * Returns `[]` when the resolved indicator has no stored bars yet.
   */
  private async _readStoredBars(symbol: string, from: string): Promise<DailyBar[]> {
    let identity: {
      type: string;
      tickerId: number | null;
      lookback: number;
      delay: number;
      unit: string | null;
      threshold: number | null;
    };
    if (symbol === '^VIX') {
      identity = { type: 'VIX', tickerId: null, lookback: 0, delay: 0, unit: null, threshold: null };
    } else if (symbol === '^VIX3M') {
      identity = { type: 'VIX3M', tickerId: null, lookback: 0, delay: 0, unit: null, threshold: null };
    } else if (FRED_SYMBOL_TO_TYPE[symbol]) {
      identity = {
        type: FRED_SYMBOL_TO_TYPE[symbol]!,
        tickerId: null,
        lookback: 0,
        delay: 0,
        unit: null,
        threshold: null,
      };
    } else {
      const { id: tickerId } = await this._storage.tickers.findOrCreate(symbol, 1);
      identity = { type: 'Price', tickerId, lookback: 0, delay: 0, unit: null, threshold: null };
    }
    const { id } = await this._storage.indicators.findOrCreate(identity);
    return this._storage.indicators.getSeries(id, { from });
  }

  // ── Public data access ─────────────────────────────────────────────

  async series(range?: DateRange): Promise<DailyBar[]> {
    if (this.type === 'Threshold') {
      return this._syntheticThresholdSeries(range);
    }
    await this._ensureFresh();
    if (this._cachedSeries && !range) return this._cachedSeries;
    const bars = await this._querySeriesFromDb(range);
    if (!range) this._cachedSeries = bars;
    return bars;
  }

  private async _syntheticThresholdSeries(range?: DateRange): Promise<DailyBar[]> {
    const v = this.threshold!;
    const dates = await this._storage.tradingDays.getRange(range);
    return dates.map((date) => ({ date, value: v }));
  }

  async value(date?: string): Promise<number | null> {
    await this._ensureFresh();
    const { id } = await this.resolve();
    return this._storage.indicators.getValue(id, date);
  }

  /**
   * Read-only preview of the indicator series with an in-memory bar at `date`
   * computed via `computeAt` with the supplied live-quote `overrides`. Does
   * NOT write to `indicators_series`. Safe to call before market close.
   *
   * @param date - Target trading day whose value is computed in-memory.
   *   Must be in `tradingDays.getRange()`.
   * @param overrides - Raw (unleveraged) quotes keyed by market symbol.
   *   Symbols omitted fall back to the last known value (see `_resolveRawBars`).
   * @param range - Optional filter applied to the returned bars.
   * @returns Stored historical bars plus (or with) today's in-memory value.
   */
  async previewSeries(date: string, overrides: Record<string, number>, range?: DateRange): Promise<DailyBar[]> {
    const tradingDays = await this._storage.tradingDays.getRange();
    if (!tradingDays.includes(date)) {
      throw new Error(`previewSeries: ${date} is not a trading day`);
    }

    let bars: DailyBar[];
    if (this.type === 'Threshold') {
      bars = await this._syntheticThresholdSeries();
    } else {
      bars = await this._querySeriesFromDb();
    }

    const todayValue = await this.computeAt(date, overrides);
    if (todayValue !== null) {
      const idx = bars.findIndex((b) => b.date === date);
      if (idx >= 0) {
        bars[idx] = { date, value: todayValue };
      } else {
        bars = [...bars, { date, value: todayValue }].sort((a, b) => a.date.localeCompare(b.date));
      }
    }

    if (range) {
      bars = bars.filter(
        (b) => (range.from === undefined || b.date >= range.from) && (range.to === undefined || b.date <= range.to),
      );
    }

    return bars;
  }
}
