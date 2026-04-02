// src/handles/signal.ts
import type { StorageProvider } from '../providers/storage.js';
import type { MarketProvider } from '../providers/market.js';
import type { Comparison } from '../providers/types.js';
import type { IndicatorHandle, DailyBar, DateRange } from './indicator.js';
import { evaluateSignal } from '../computations/signal.js';

const ABSOLUTE_TOLERANCE_TYPES = new Set([
  'Return',
  'Volatility',
  'Drawdown',
  'VIX',
  'VIX3M',
  'T3M',
  'T6M',
  'T1Y',
  'T2Y',
  'T3Y',
  'T5Y',
  'T7Y',
  'T10Y',
  'T20Y',
  'T30Y',
]);

export interface SignalIdentity {
  indicator1: IndicatorHandle;
  indicator2: IndicatorHandle;
  comparison: Comparison;
  tolerance: number;
}

export class SignalHandle {
  readonly indicator1: IndicatorHandle;
  readonly indicator2: IndicatorHandle;
  readonly comparison: Comparison;
  readonly tolerance: number;

  private _storage: StorageProvider;
  private _market: MarketProvider;
  private _resolvedId: number | null = null;
  private _resolving: Promise<{ id: number }> | null = null;

  private _cachedSeries: DailyBar[] | null = null;
  private _cachedAsOf: string | null = null;
  private _syncing: Promise<void> | null = null;

  constructor(storage: StorageProvider, market: MarketProvider, identity: SignalIdentity) {
    this._storage = storage;
    this._market = market;
    this.indicator1 = identity.indicator1;
    this.indicator2 = identity.indicator2;
    this.comparison = identity.comparison;
    this.tolerance = identity.tolerance;
  }

  get id(): number {
    if (this._resolvedId == null)
      throw new Error('SignalHandle not yet resolved. Call resolve(), or access via an async method.');
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
    identity: SignalIdentity,
  ): SignalHandle {
    const handle = new SignalHandle(storage, market, identity);
    handle._resolvedId = id;
    return handle;
  }

  private async _doResolve(): Promise<{ id: number }> {
    const [ind1, ind2] = await Promise.all([this.indicator1.resolve(), this.indicator2.resolve()]);
    const result = await this._storage.signals.upsert({
      indicatorId1: ind1.id,
      indicatorId2: ind2.id,
      comparison: this.comparison,
      tolerance: this.tolerance,
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

  private async _getLatestSignalSeriesDate(signalId: number): Promise<string | null> {
    return this._storage.signals.getLatestSeriesDate(signalId);
  }

  private async _getLastSignalValue(signalId: number): Promise<number | null> {
    return this._storage.signals.getLastValue(signalId);
  }

  private async _ensureFresh(): Promise<void> {
    const { id } = await this.resolve();
    const latestClosed = await this._getLatestClosedTradingDay();

    if (this._cachedAsOf === latestClosed) return;

    // Ensure both indicators are fresh first
    await Promise.all([this.indicator1.series(), this.indicator2.series()]);

    const latestSeries = await this._getLatestSignalSeriesDate(id);

    if (latestSeries === latestClosed) {
      this._cachedSeries = null;
      this._cachedAsOf = latestClosed;
      return;
    }

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
    const { id } = await this.resolve();

    const range = fromDate ? { from: fromDate } : undefined;
    const [series1, series2] = await Promise.all([this.indicator1.series(range), this.indicator2.series(range)]);

    const previousValue = fromDate ? ((await this._getLastSignalValue(id)) ?? undefined) : undefined;

    const absolute = ABSOLUTE_TOLERANCE_TYPES.has(this.indicator1.type);
    const signalBars = evaluateSignal(series1, series2, this.comparison, this.tolerance, absolute, previousValue);

    const bars = signalBars.filter((b) => b.date <= latestClosed);

    if (bars.length > 0) {
      await this._upsertSeries(bars);
    }
  }

  private async _upsertSeries(bars: DailyBar[]): Promise<void> {
    const { id } = await this.resolve();
    await this._storage.signals.writeSeries(id, bars);
  }

  private async _querySeriesFromDb(range?: DateRange): Promise<DailyBar[]> {
    const { id } = await this.resolve();
    return this._storage.signals.getSeries(id, range);
  }

  // ── Public data access ─────────────────────────────────────────────

  async series(range?: DateRange): Promise<DailyBar[]> {
    await this._ensureFresh();
    if (this._cachedSeries && !range) return this._cachedSeries;
    const bars = await this._querySeriesFromDb(range);
    if (!range) this._cachedSeries = bars;
    return bars;
  }

  async value(date?: string): Promise<number | null> {
    await this._ensureFresh();
    if (date) {
      const series = await this._querySeriesFromDb({ from: date, to: date });
      return series.length > 0 ? series[0]!.value : null;
    }
    const { id } = await this.resolve();
    return this._storage.signals.getLastValue(id);
  }
}
