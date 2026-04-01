// src/handles/signal.ts
import type { TypedSupabaseClient } from '../types.js';
import type { Tables, Database } from '../database.types.js';
import type { IndicatorHandle, DailyBar, DateRange, IndicatorConfig } from './indicator.js';
import { evaluateSignal } from '../computations/signal.js';

type SignalRow = Tables<'signals'>;
type Comparison = Database['public']['Enums']['comparison'];

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

  private _supabase: TypedSupabaseClient;
  private _config: IndicatorConfig;
  private _resolved: SignalRow | null = null;
  private _resolving: Promise<SignalRow> | null = null;

  private _cachedSeries: DailyBar[] | null = null;
  private _cachedAsOf: string | null = null;
  private _syncing: Promise<void> | null = null;

  constructor(supabase: TypedSupabaseClient, identity: SignalIdentity, config?: IndicatorConfig) {
    this._supabase = supabase;
    this._config = config ?? {};
    this.indicator1 = identity.indicator1;
    this.indicator2 = identity.indicator2;
    this.comparison = identity.comparison;
    this.tolerance = identity.tolerance;
  }

  get id(): number {
    if (!this._resolved)
      throw new Error('SignalHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolved.id;
  }

  async resolve(): Promise<SignalRow> {
    if (this._resolved) return this._resolved;
    if (!this._resolving) this._resolving = this._doResolve();
    return this._resolving;
  }

  static fromRow(
    supabase: TypedSupabaseClient,
    row: SignalRow,
    indicator1: IndicatorHandle,
    indicator2: IndicatorHandle,
    config?: IndicatorConfig,
  ): SignalHandle {
    const handle = new SignalHandle(
      supabase,
      { indicator1, indicator2, comparison: row.comparison, tolerance: row.tolerance },
      config,
    );
    handle._resolved = row;
    return handle;
  }

  private async _doResolve(): Promise<SignalRow> {
    const [ind1Row, ind2Row] = await Promise.all([this.indicator1.resolve(), this.indicator2.resolve()]);

    const { data, error } = await this._supabase
      .from('signals')
      .upsert(
        {
          indicator_id_1: ind1Row.id,
          indicator_id_2: ind2Row.id,
          comparison: this.comparison,
          tolerance: this.tolerance,
        },
        { onConflict: 'indicator_id_1,indicator_id_2,comparison,tolerance' },
      )
      .select()
      .single();

    if (error) throw error;
    this._resolved = data;
    return data;
  }

  private async _getLatestClosedTradingDay(): Promise<string> {
    const { data, error } = await this._supabase
      .from('trading_days')
      .select('date')
      .lt('post', new Date().toISOString())
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (error) throw error;
    return data.date;
  }

  private async _getLatestSignalSeriesDate(signalId: number): Promise<string | null> {
    const { data, error } = await this._supabase
      .from('signals_series')
      .select('trading_days!inner(date)')
      .eq('signal_id', signalId)
      .order('trading_day_id', { ascending: false })
      .limit(1)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw error;
    return (data as unknown as { trading_days: { date: string } }).trading_days.date;
  }

  private async _getLastSignalValue(signalId: number): Promise<number | undefined> {
    const { data, error } = await this._supabase
      .from('signals_series')
      .select('value')
      .eq('signal_id', signalId)
      .order('trading_day_id', { ascending: false })
      .limit(1)
      .single();

    if (error?.code === 'PGRST116') return undefined;
    if (error) throw error;
    return data.value ? 1 : 0;
  }

  private async _ensureFresh(): Promise<void> {
    const row = await this.resolve();
    const latestClosed = await this._getLatestClosedTradingDay();

    if (this._cachedAsOf === latestClosed) return;

    // Ensure both indicators are fresh first
    await Promise.all([this.indicator1.series(), this.indicator2.series()]);

    const latestSeries = await this._getLatestSignalSeriesDate(row.id);

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
    const row = await this.resolve();

    const range = fromDate ? { from: fromDate } : undefined;
    const [series1, series2] = await Promise.all([this.indicator1.series(range), this.indicator2.series(range)]);

    const previousValue = fromDate ? await this._getLastSignalValue(row.id) : undefined;

    const absolute = ABSOLUTE_TOLERANCE_TYPES.has(this.indicator1.type);
    const signalBars = evaluateSignal(series1, series2, this.comparison, this.tolerance, absolute, previousValue);

    const bars = signalBars.filter((b) => b.date <= latestClosed);

    if (bars.length > 0) {
      await this._upsertSeries(bars);
    }
  }

  private async _upsertSeries(bars: DailyBar[]): Promise<void> {
    const row = await this.resolve();
    const minDate = bars[0].date;
    const maxDate = bars[bars.length - 1].date;

    // Paginate trading days lookup (PostgREST defaults to 1000 rows)
    const PAGE = 1000;
    const dateToId = new Map<string, number>();
    let offset = 0;

    while (true) {
      const { data: tradingDays, error: tdError } = await this._supabase
        .from('trading_days')
        .select('id, date')
        .gte('date', minDate)
        .lte('date', maxDate)
        .range(offset, offset + PAGE - 1);

      if (tdError) throw tdError;

      for (const td of tradingDays) {
        dateToId.set(td.date, td.id);
      }

      if (tradingDays.length < PAGE) break;
      offset += PAGE;
    }

    const rows = bars
      .filter((b) => dateToId.has(b.date))
      .map((b) => ({
        signal_id: row.id,
        trading_day_id: dateToId.get(b.date)!,
        value: b.value === 1,
      }));

    if (rows.length === 0) return;

    const { error } = await this._supabase
      .from('signals_series')
      .upsert(rows, { onConflict: 'signal_id,trading_day_id' });

    if (error) throw error;
  }

  private async _querySeriesFromDb(range?: DateRange): Promise<DailyBar[]> {
    const row = await this.resolve();
    const PAGE = 1000;
    const all: DailyBar[] = [];
    let offset = 0;

    while (true) {
      let query = this._supabase
        .from('signals_series')
        .select('value, trading_days!inner(date)')
        .eq('signal_id', row.id)
        .order('trading_day_id', { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (range?.from) query = query.gte('trading_days.date', range.from);
      if (range?.to) query = query.lte('trading_days.date', range.to);

      const { data, error } = await query;
      if (error) throw error;

      const bars = (data as unknown as { value: boolean; trading_days: { date: string } }[]).map((r) => ({
        date: r.trading_days.date,
        value: r.value ? 1 : 0,
      }));

      all.push(...bars);
      if (bars.length < PAGE) break;
      offset += PAGE;
    }

    return all;
  }

  async series(range?: DateRange): Promise<DailyBar[]> {
    await this._ensureFresh();
    if (this._cachedSeries && !range) return this._cachedSeries;
    const bars = await this._querySeriesFromDb(range);
    if (!range) this._cachedSeries = bars;
    return bars;
  }

  async value(date?: string): Promise<number | null> {
    await this._ensureFresh();
    const row = await this.resolve();

    if (date) {
      const { data: td, error: tdError } = await this._supabase
        .from('trading_days')
        .select('id')
        .eq('date', date)
        .single();

      if (tdError?.code === 'PGRST116') return null;
      if (tdError) throw tdError;

      const { data, error } = await this._supabase
        .from('signals_series')
        .select('value')
        .eq('signal_id', row.id)
        .eq('trading_day_id', td.id)
        .single();

      if (error?.code === 'PGRST116') return null;
      if (error) throw error;
      return data.value ? 1 : 0;
    }

    const { data, error } = await this._supabase
      .from('signals_series')
      .select('value')
      .eq('signal_id', row.id)
      .order('trading_day_id', { ascending: false })
      .limit(1)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw error;
    return data.value ? 1 : 0;
  }
}
