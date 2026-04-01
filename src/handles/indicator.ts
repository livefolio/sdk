import type { TypedSupabaseClient } from '../types.js';
import type { Tables, Database } from '../database.types.js';
import { TickerHandle } from './ticker.js';
import { fetchYahoo } from '../providers/yahoo.js';
import { fetchFred } from '../providers/fred.js';
import { getProviderInfo } from '../providers/mappings.js';
import { getComputation } from '../computations/index.js';
import { computeCalendar } from '../computations/calendar.js';

type IndicatorRow = Tables<'indicators'>;
type IndicatorType = Database['public']['Enums']['indicator_type'];
type Unit = Database['public']['Enums']['unit'];

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

export interface IndicatorConfig {
  fredApiKey?: string;
}

export class IndicatorHandle {
  readonly type: IndicatorType;
  readonly ticker: TickerHandle | null;
  readonly lookback: number;
  readonly delay: number;
  readonly unit: Unit | null;
  readonly threshold: number | null;

  private _supabase: TypedSupabaseClient;
  private _config: IndicatorConfig;
  private _resolved: IndicatorRow | null = null;
  private _resolving: Promise<IndicatorRow> | null = null;

  private _cachedSeries: DailyBar[] | null = null;
  private _cachedAsOf: string | null = null;
  private _syncing: Promise<void> | null = null;

  constructor(supabase: TypedSupabaseClient, identity: IndicatorIdentity, config?: IndicatorConfig) {
    this._supabase = supabase;
    this._config = config ?? {};
    this.type = identity.type;
    this.ticker = identity.ticker;
    this.lookback = identity.lookback;
    this.delay = identity.delay;
    this.unit = identity.unit;
    this.threshold = identity.threshold;
  }

  get id(): number {
    if (!this._resolved)
      throw new Error('IndicatorHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolved.id;
  }

  async resolve(): Promise<IndicatorRow> {
    if (this._resolved) return this._resolved;
    if (!this._resolving) this._resolving = this._doResolve();
    return this._resolving;
  }

  static fromRow(
    supabase: TypedSupabaseClient,
    row: IndicatorRow,
    ticker: TickerHandle | null,
    config?: IndicatorConfig,
  ): IndicatorHandle {
    const handle = new IndicatorHandle(
      supabase,
      { type: row.type, ticker, lookback: row.lookback, delay: row.delay, unit: row.unit, threshold: row.threshold },
      config,
    );
    handle._resolved = row;
    return handle;
  }

  private async _doResolve(): Promise<IndicatorRow> {
    const tickerId = this.ticker ? (await this.ticker.resolve()).id : null;

    // Note: We use update-on-conflict (default) rather than ignoreDuplicates: true
    // because PostgREST does not return the existing row with ignoreDuplicates.
    const { data, error } = await this._supabase
      .from('indicators')
      .upsert(
        {
          type: this.type,
          ticker_id: tickerId,
          lookback: this.lookback,
          delay: this.delay,
          unit: this.unit,
          threshold: this.threshold,
        },
        { onConflict: 'type,ticker_id,lookback,delay,unit,threshold' },
      )
      .select()
      .single();

    if (error) throw error;
    this._resolved = data;
    return data;
  }

  // ── Freshness & Sync ───────────────────────────────────────────────

  private async _getLatestClosedTradingDay(): Promise<string> {
    const { data, error } = await this._supabase
      .from('trading_days')
      .select('date')
      .lt('close', new Date().toISOString())
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (error) throw error;
    return data.date;
  }

  private async _getLatestSeriesDate(indicatorId: number): Promise<string | null> {
    const { data, error } = await this._supabase
      .from('indicators_series')
      .select('trading_days!inner(date)')
      .eq('indicator_id', indicatorId)
      .order('trading_day_id', { ascending: false })
      .limit(1)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw error;
    return (data as unknown as { trading_days: { date: string } }).trading_days.date;
  }

  private async _ensureFresh(): Promise<void> {
    const row = await this.resolve();
    const latestClosed = await this._getLatestClosedTradingDay();

    // In-memory cache still valid
    if (this._cachedAsOf === latestClosed) return;

    const latestSeries = await this._getLatestSeriesDate(row.id);

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
        bars = await fetchYahoo(info.symbol, fromDate);
        break;

      case 'fred':
        if (!this._config.fredApiKey) {
          throw new Error(`FRED API key required for indicator type "${this.type}"`);
        }
        bars = await fetchFred(info.seriesId, this._config.fredApiKey, fromDate);
        break;

      case 'computed': {
        // Create an internal Price handle for the same ticker
        const priceHandle = new IndicatorHandle(
          this._supabase,
          {
            type: 'Price',
            ticker: this.ticker,
            lookback: 0,
            delay: 0,
            unit: null,
            threshold: null,
          },
          this._config,
        );

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
        // Fetch all trading days to compute calendar values (paginated)
        const allDays: { date: string }[] = [];
        let calOffset = 0;

        while (true) {
          const { data: dayPage, error: daysError } = await this._supabase
            .from('trading_days')
            .select('date')
            .order('date', { ascending: true })
            .range(calOffset, calOffset + 1000 - 1);

          if (daysError) throw daysError;

          allDays.push(...dayPage);
          if (dayPage.length < 1000) break;
          calOffset += 1000;
        }

        const dayBars: DailyBar[] = allDays.map((d) => ({ date: d.date, value: 0 }));
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

    // Filter bars up to latestClosed
    bars = bars.filter((b) => b.date <= latestClosed);

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
        indicator_id: row.id,
        trading_day_id: dateToId.get(b.date)!,
        value: b.value,
      }));

    if (rows.length === 0) return;

    const { error } = await this._supabase
      .from('indicators_series')
      .upsert(rows, { onConflict: 'indicator_id,trading_day_id' });

    if (error) throw error;
  }

  private async _querySeriesFromDb(range?: DateRange): Promise<DailyBar[]> {
    const row = await this.resolve();
    const PAGE = 1000;
    const all: DailyBar[] = [];
    let offset = 0;

    while (true) {
      let query = this._supabase
        .from('indicators_series')
        .select('value, trading_days!inner(date)')
        .eq('indicator_id', row.id)
        .order('trading_day_id', { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (range?.from) query = query.gte('trading_days.date', range.from);
      if (range?.to) query = query.lte('trading_days.date', range.to);

      const { data, error } = await query;
      if (error) throw error;

      const bars = (data as unknown as { value: number; trading_days: { date: string } }[]).map((r) => ({
        date: r.trading_days.date,
        value: r.value,
      }));

      all.push(...bars);
      if (bars.length < PAGE) break;
      offset += PAGE;
    }

    return all;
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
    const row = await this.resolve();

    if (date) {
      // Look up trading_day_id directly to avoid PostgREST foreign-table filter semantics
      const { data: td, error: tdError } = await this._supabase
        .from('trading_days')
        .select('id')
        .eq('date', date)
        .single();

      if (tdError?.code === 'PGRST116') return null; // no trading day for this date
      if (tdError) throw tdError;

      const { data, error } = await this._supabase
        .from('indicators_series')
        .select('value')
        .eq('indicator_id', row.id)
        .eq('trading_day_id', td.id)
        .single();

      if (error?.code === 'PGRST116') return null;
      if (error) throw error;
      return data.value;
    }

    // No date: get the most recent value
    const { data, error } = await this._supabase
      .from('indicators_series')
      .select('value')
      .eq('indicator_id', row.id)
      .order('trading_day_id', { ascending: false })
      .limit(1)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw error;
    return data.value;
  }
}
