import { nanoid } from 'nanoid';
import type { TypedSupabaseClient } from '../types.js';
import type { Tables, Database } from '../database.types.js';
import { SignalHandle } from './signal.js';
import { AllocationHandle } from './allocation.js';
import type { DateRange, IndicatorConfig } from './indicator.js';

type StrategyRow = Tables<'strategies'>;
type TradingFreq = Database['public']['Enums']['trading_freq'];

export interface StrategyRule {
  when?: SignalHandle[];
  hold: AllocationHandle;
}

export interface StrategyBar {
  date: string;
  allocation: AllocationHandle;
}

export interface StrategyOptions {
  name: string;
  freq?: TradingFreq;
  offset?: number;
  rules: StrategyRule[];
}

export class StrategyHandle {
  private _linkId: string | null;
  private _name: string | null;
  private _freq: TradingFreq;
  private _offset: number;
  private _rules: StrategyRule[];

  private _supabase: TypedSupabaseClient;
  private _config: IndicatorConfig;
  private _resolved: StrategyRow | null = null;
  private _resolving: Promise<StrategyRow> | null = null;
  private _allocationMap: Map<number, AllocationHandle> = new Map();

  private _cache: StrategyBar[] | null = null;
  private _cachedAsOf: string | null = null;
  private _syncing: Promise<void> | null = null;

  constructor(supabase: TypedSupabaseClient, optionsOrLinkId: StrategyOptions | string, config?: IndicatorConfig) {
    this._supabase = supabase;
    this._config = config ?? {};

    if (typeof optionsOrLinkId === 'string') {
      this._linkId = optionsOrLinkId;
      this._name = null;
      this._freq = 'Daily';
      this._offset = 0;
      this._rules = [];
    } else {
      const opts = optionsOrLinkId;
      if (opts.rules.length === 0) {
        throw new Error('Strategy must have at least one rule');
      }
      const lastRule = opts.rules[opts.rules.length - 1];
      if (lastRule.when && lastRule.when.length > 0) {
        throw new Error('Last rule must be a fallback (no when clause)');
      }
      this._linkId = null;
      this._name = opts.name;
      this._freq = opts.freq ?? 'Daily';
      this._offset = opts.offset ?? 0;
      this._rules = opts.rules;
    }
  }

  get id(): number {
    if (!this._resolved) throw new Error('StrategyHandle not yet resolved. Call resolve() first.');
    return this._resolved.id;
  }

  get link(): string {
    if (!this._resolved) throw new Error('StrategyHandle not yet resolved. Call resolve() first.');
    return this._resolved.link_id;
  }

  get name(): string | null {
    return this._name;
  }

  get freq(): TradingFreq {
    return this._freq;
  }

  get offset(): number {
    return this._offset;
  }

  get rules(): StrategyRule[] {
    return this._rules;
  }

  async resolve(): Promise<StrategyRow> {
    if (this._resolved) return this._resolved;
    if (!this._resolving) {
      this._resolving =
        this._linkId !== null && this._name === null ? this._doResolveReference() : this._doResolveCreate();
    }
    return this._resolving;
  }

  private async _doResolveCreate(): Promise<StrategyRow> {
    const allSignals = new Set<SignalHandle>();
    const allAllocations = new Set<AllocationHandle>();
    for (const rule of this._rules) {
      if (rule.when) rule.when.forEach((s) => allSignals.add(s));
      allAllocations.add(rule.hold);
    }

    await Promise.all([
      ...Array.from(allSignals).map((s) => s.resolve()),
      ...Array.from(allAllocations).map((a) => a.resolve()),
    ]);

    const definition = {
      rules: this._rules.map((rule) => ({
        signalIds: (rule.when ?? []).map((s) => s.id),
        allocationId: rule.hold.id,
      })),
    };

    const linkId = nanoid();

    const { data, error } = await this._supabase
      .from('strategies')
      .insert({
        link_id: linkId,
        name: this._name!,
        trading_freq: this._freq,
        trading_offset: this._offset,
        definition,
      })
      .select()
      .single();

    if (error) throw error;
    this._resolved = data;

    for (const rule of this._rules) {
      this._allocationMap.set(rule.hold.id, rule.hold);
    }

    return data;
  }

  private async _doResolveReference(): Promise<StrategyRow> {
    throw new Error('Not implemented');
  }

  async series(_range?: DateRange): Promise<StrategyBar[]> {
    throw new Error('Not implemented');
  }

  async value(_date?: string): Promise<AllocationHandle | null> {
    throw new Error('Not implemented');
  }
}
