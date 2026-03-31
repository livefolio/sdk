import type { TypedSupabaseClient } from '../types.js';
import type { Tables } from '../database.types.js';

type TickerRow = Tables<'tickers'>;

export class TickerHandle {
  readonly symbol: string;
  readonly leverage: number;

  private _supabase: TypedSupabaseClient;
  private _resolved: TickerRow | null = null;

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
