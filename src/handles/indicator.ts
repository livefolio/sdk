import type { TypedSupabaseClient } from '../types.js';
import type { Tables, Database } from '../database.types.js';
import type { TickerHandle } from './ticker.js';

type IndicatorRow = Tables<'indicators'>;
type IndicatorSeriesRow = Tables<'indicators_series'>;
type IndicatorType = Database['public']['Enums']['indicator_type'];
type Unit = Database['public']['Enums']['unit'];

export type IndicatorSeriesWithDate = IndicatorSeriesRow & {
  trading_days: { date: string };
};

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

  private _supabase: TypedSupabaseClient;
  private _resolved: IndicatorRow | null = null;
  private _resolving: Promise<IndicatorRow> | null = null;

  constructor(supabase: TypedSupabaseClient, identity: IndicatorIdentity) {
    this._supabase = supabase;
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

  async series(range?: DateRange): Promise<IndicatorSeriesWithDate[]> {
    const row = await this.resolve();
    let query = this._supabase
      .from('indicators_series')
      .select('*, trading_days!inner(date)')
      .eq('indicator_id', row.id)
      .order('trading_day_id', { ascending: true });

    if (range?.from) query = query.gte('trading_days.date', range.from);
    if (range?.to) query = query.lte('trading_days.date', range.to);

    const { data, error } = await query;
    if (error) throw error;
    return data as IndicatorSeriesWithDate[];
  }

  async value(date?: string): Promise<number | null> {
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
