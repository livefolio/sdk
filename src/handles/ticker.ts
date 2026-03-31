import type { TypedSupabaseClient } from '../types.js';
import type { Tables } from '../database.types.js';

type TickerRow = Tables<'tickers'>;

export class TickerHandle {
  readonly symbol: string;
  readonly leverage: number;

  private _supabase: TypedSupabaseClient;
  private _resolved: TickerRow | null = null;
  private _resolving: Promise<TickerRow> | null = null;

  constructor(supabase: TypedSupabaseClient, symbol: string, leverage: number = 1) {
    this._supabase = supabase;
    this.symbol = symbol;
    this.leverage = leverage;
  }

  get id(): number {
    if (!this._resolved)
      throw new Error('TickerHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolved.id;
  }

  async resolve(): Promise<TickerRow> {
    if (this._resolved) return this._resolved;
    if (!this._resolving) this._resolving = this._doResolve();
    return this._resolving;
  }

  static fromRow(supabase: TypedSupabaseClient, row: TickerRow): TickerHandle {
    const handle = new TickerHandle(supabase, row.symbol, row.leverage);
    handle._resolved = row;
    return handle;
  }

  private async _doResolve(): Promise<TickerRow> {
    // Note: We use update-on-conflict (default) rather than ignoreDuplicates: true
    // because PostgREST does not return the existing row with ignoreDuplicates.
    const { data, error } = await this._supabase
      .from('tickers')
      .upsert({ symbol: this.symbol, leverage: this.leverage }, { onConflict: 'symbol,leverage' })
      .select()
      .single();

    if (error) throw error;
    this._resolved = data;
    return data;
  }
}
