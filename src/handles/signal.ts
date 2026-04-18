// src/handles/signal.ts
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';
import type { Comparison } from '../providers/types';
import type { IndicatorHandle, DailyBar, DateRange } from './indicator';
import { evaluateSignal } from '../computations/signal';

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
    const result = await this._storage.signals.findOrCreate({
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

  withMarket(market: MarketProvider): SignalHandle {
    if (market === this._market) return this;
    return SignalHandle.fromResolved(this._storage, market, this.id, {
      indicator1: this.indicator1.withMarket(market),
      indicator2: this.indicator2.withMarket(market),
      comparison: this.comparison,
      tolerance: this.tolerance,
    });
  }

  /**
   * Compute the signal's boolean value at `date` using the given market
   * (typically an overlay market for pre-close preview). Pure — no writes.
   * Returns null if either indicator cannot produce a value at `date`.
   *
   * @param prevBool - The signal's boolean value at the bar immediately
   *   preceding `date`, used for hysteresis when `tolerance > 0`. If not
   *   provided, falls back to `storage.signals.getLastValue` (suitable for
   *   standalone callers). On the preview path `_evaluate` passes this from
   *   the in-memory `dateMap` so we never read stale storage.
   */
  async computeAt(market: MarketProvider, date: string, prevBool?: boolean | null): Promise<boolean | null> {
    const [v1, v2] = await Promise.all([
      this.indicator1.computeAt(market, date),
      this.indicator2.computeAt(market, date),
    ]);
    if (v1 === null || v2 === null) return null;

    const absolute = ABSOLUTE_TOLERANCE_TYPES.has(this.indicator1.type);

    // Replicate the evaluateSignal single-bar logic inline (no hysteresis needed
    // for a single-point preview; we use the last historical value as "prev").
    if (this.tolerance === 0) {
      switch (this.comparison) {
        case '>':
          return v1 > v2;
        case '<':
          return v1 < v2;
        case '=':
          return v1 === v2;
      }
    }

    const tolerance = this.tolerance;
    const upper = absolute ? v2 + tolerance : v2 * (1 + tolerance / 100);
    const lower = absolute ? v2 - tolerance : v2 * (1 - tolerance / 100);

    if (this.comparison === '=') {
      return v1 >= lower && v1 <= upper;
    }
    // For '>' and '<' with tolerance, we need hysteresis (prev state).
    // Use the in-memory prevBool if provided (preview path); otherwise fall
    // back to storage (standalone callers / write path).
    let resolvedPrevBool: boolean;
    if (prevBool !== undefined && prevBool !== null) {
      resolvedPrevBool = prevBool;
    } else {
      const prev = await this._storage.signals.getLastValue(this.id);
      resolvedPrevBool = prev === 1;
    }
    if (this.comparison === '>') {
      return resolvedPrevBool ? v1 >= lower : v1 > upper;
    }
    // '<'
    return resolvedPrevBool ? v1 <= upper : v1 < lower;
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
