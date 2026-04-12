import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';
import type { IndicatorType, Unit } from '../providers/types';
import { TickerHandle } from './ticker';
import { getProviderInfo } from '../providers/mappings';
import { getComputation } from '../computations/index';
import { computeCalendar } from '../computations/calendar';

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

        const computeFn = getComputation(this.type);
        if (!computeFn) throw new Error(`No computation found for type "${this.type}"`);

        bars = computeFn(priceBars, this.lookback);

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
    const leverage = this.ticker?.leverage ?? 1;
    if (leverage !== 1 && info.provider !== 'computed' && bars.length > 0) {
      const leveraged: DailyBar[] = [bars[0]!];
      for (let i = 1; i < bars.length; i++) {
        const dailyReturn = (bars[i]!.value - bars[i - 1]!.value) / bars[i - 1]!.value;
        const prev = leveraged[i - 1]!.value;
        leveraged.push({ date: bars[i]!.date, value: prev * (1 + leverage * dailyReturn) });
      }
      bars = leveraged;
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
