import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';
import type { IndicatorType, Unit } from '../providers/types';
import { TickerHandle } from './ticker';
import { getProviderInfo, isRateTickerSymbol } from '../providers/mappings';
import { getComputation } from '../computations/index';
import { computeReturns } from '../computations/returns';
import { computeCalendar } from '../computations/calendar';

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

    // Need to sync — deduplicate concurrent calls
    if (!this._syncing) {
      this._syncing = this._sync(latestSeries ?? undefined, latestClosed).finally(() => {
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

  withMarket(market: MarketProvider): IndicatorHandle {
    if (market === this._market) return this;
    return IndicatorHandle.fromResolved(this._storage, market, this.id, {
      type: this.type,
      ticker: this.ticker,
      lookback: this.lookback,
      delay: this.delay,
      unit: this.unit,
      threshold: this.threshold,
    });
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
   * Compute the indicator's value at `date` using the given market (typically
   * an overlay market for pre-close preview). Pure — no writes to storage.
   *
   * For fetched types (yahoo/fred): fetches a small window of bars from
   * `market`, applies leverage compounding anchored to the stored leveraged
   * value at the bar before `date`.
   * For computed types (SMA, RSI, etc.): fetches enough raw price bars to
   * cover the indicator's lookback from `market`, applies leverage anchored
   * to the stored value just before the fetch window, runs the computation,
   * and returns the value at `date`.
   * For Threshold: returns the threshold constant.
   * For calendar: computes calendar value from the trading days list.
   * Returns null if the value cannot be computed.
   */
  async computeAt(market: MarketProvider, date: string): Promise<number | null> {
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
      // Fetch enough raw price bars to cover lookback + buffer (weekends/holidays).
      // We need `lookback` trading days before `date`, so we request a calendar
      // window of (lookback + 10) days to comfortably cover non-trading days.
      const from = _subtractCalendarDays(date, this.lookback + 10);
      const rawBars = await market.fetchBars(info.symbol, from);

      // Apply leverage anchored to the stored leveraged value at the date just
      // before the first fetched raw bar. This mirrors _sync's anchor logic
      // exactly: fromDate is the last stored bar, anchor is getValue(id, fromDate).
      const anchorDate = rawBars.length > 0 ? rawBars[0]!.date : undefined;
      const priceBars = await this._applyLeverage(rawBars, anchorDate);

      const computeFn = getComputation(this.type);
      if (!computeFn) throw new Error(`No computation found for type "${this.type}"`);
      const computed = computeFn(priceBars, this.lookback);
      return computed.find((b) => b.date === date)?.value ?? null;
    }

    // yahoo or fred: fetch a small window — just enough to get `date` and one
    // prior bar (needed for leverage return calculation). 5 calendar days is
    // enough to bridge a long weekend.
    const symbol = info.provider === 'yahoo' ? info.symbol : info.seriesId;
    const from = _subtractCalendarDays(date, 5);
    const rawBars = await market.fetchBars(symbol, from);

    const leverage = this.ticker?.leverage ?? 1;
    if (leverage === 1) {
      return rawBars.find((b) => b.date === date)?.value ?? null;
    }

    // Apply leverage compounding.
    // Find the bar just before `date` in rawBars to use as anchor reference.
    const dateIdx = rawBars.findIndex((b) => b.date === date);
    if (dateIdx < 0) return null; // date not in bars at all

    // We need the stored leveraged value at the previous day to anchor.
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
}
