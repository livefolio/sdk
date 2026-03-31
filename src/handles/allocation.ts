import type { TypedSupabaseClient } from '../types.js';
import type { Tables } from '../database.types.js';
import type { TickerHandle } from './ticker.js';

type AllocationRow = Tables<'allocations'>;

export class AllocationHandle {
  readonly holdings: [TickerHandle, number][];

  private _supabase: TypedSupabaseClient;
  private _resolved: AllocationRow | null = null;
  private _resolving: Promise<AllocationRow> | null = null;

  constructor(supabase: TypedSupabaseClient, holdings: [TickerHandle, number][]) {
    this._supabase = supabase;
    this.holdings = holdings;
  }

  get id(): number {
    if (!this._resolved)
      throw new Error('AllocationHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolved.id;
  }

  async resolve(): Promise<AllocationRow> {
    if (this._resolved) return this._resolved;
    if (!this._resolving) this._resolving = this._doResolve();
    return this._resolving;
  }

  private async _doResolve(): Promise<AllocationRow> {
    // Resolve all tickers in parallel
    await Promise.all(this.holdings.map(([ticker]) => ticker.resolve()));

    // Build the holdings JSONB
    const holdingsJson: Record<string, number> = {};
    for (const [ticker, weight] of this.holdings) {
      const key = ticker.leverage !== 1 ? `${ticker.symbol}?L=${ticker.leverage}` : ticker.symbol;
      holdingsJson[key] = weight;
    }

    // Check for existing allocation with same holdings
    const { data: existing, error: findError } = await this._supabase
      .from('allocations')
      .select()
      .eq('holdings', JSON.stringify(holdingsJson))
      .limit(1)
      .single();

    if (existing && !findError) {
      this._resolved = existing;
      return existing;
    }

    if (findError && findError.code !== 'PGRST116') throw findError;

    // Not found — insert
    const { data, error } = await this._supabase
      .from('allocations')
      .insert({ holdings: holdingsJson })
      .select()
      .single();

    if (error) throw error;
    this._resolved = data;
    return data;
  }
}
