import { nanoid } from 'nanoid';
import type { TypedSupabaseClient } from '../types.js';
import type { Tables, Database } from '../database.types.js';
import { SignalHandle } from './signal.js';
import { AllocationHandle } from './allocation.js';
import { TickerHandle } from './ticker.js';
import { IndicatorHandle } from './indicator.js';
import type { DateRange, IndicatorConfig } from './indicator.js';
import { evaluateStrategy, computeRebalanceDates } from '../computations/strategy.js';
import { runSimulation } from '../backtest/simulate.js';
import { SimulationHandle } from '../backtest/types.js';
import type { SimulateOptions } from '../backtest/types.js';

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
      for (let i = 0; i < opts.rules.length - 1; i++) {
        const rule = opts.rules[i];
        if (rule.when !== undefined && rule.when.length === 0) {
          throw new Error(
            `Rule ${i} has an empty when clause and will match unconditionally, making subsequent rules unreachable`,
          );
        }
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
    const { data: stratRow, error } = await this._supabase
      .from('strategies')
      .select()
      .eq('link_id', this._linkId!)
      .single();

    if (error) throw error;

    this._name = stratRow.name;
    this._freq = stratRow.trading_freq;
    this._offset = stratRow.trading_offset;

    const def = stratRow.definition as {
      rules: { signalIds: number[]; allocationId: number }[];
    };

    // Collect all IDs needed
    const signalIds = new Set<number>();
    const allocationIds = new Set<number>();
    for (const rule of def.rules) {
      rule.signalIds.forEach((id) => signalIds.add(id));
      allocationIds.add(rule.allocationId);
    }

    // Batch fetch signals and allocations
    const [signalRows, allocationRows] = await Promise.all([
      signalIds.size > 0
        ? this._supabase
            .from('signals')
            .select()
            .in('id', Array.from(signalIds))
            .then((r) => {
              if (r.error) throw r.error;
              return r.data;
            })
        : Promise.resolve([]),
      this._supabase
        .from('allocations')
        .select()
        .in('id', Array.from(allocationIds))
        .then((r) => {
          if (r.error) throw r.error;
          return r.data;
        }),
    ]);

    // Fetch indicators needed by signals
    const indicatorIds = new Set<number>();
    for (const sr of signalRows) {
      indicatorIds.add(sr.indicator_id_1);
      indicatorIds.add(sr.indicator_id_2);
    }

    const indicatorRows =
      indicatorIds.size > 0
        ? await this._supabase
            .from('indicators')
            .select()
            .in('id', Array.from(indicatorIds))
            .then((r) => {
              if (r.error) throw r.error;
              return r.data;
            })
        : [];

    // Fetch tickers needed by indicators
    const tickerIds = new Set<number>();
    for (const ir of indicatorRows) {
      if (ir.ticker_id) tickerIds.add(ir.ticker_id);
    }

    const tickerRows =
      tickerIds.size > 0
        ? await this._supabase
            .from('tickers')
            .select()
            .in('id', Array.from(tickerIds))
            .then((r) => {
              if (r.error) throw r.error;
              return r.data;
            })
        : [];

    // Build handle maps bottom-up
    const tickerMap = new Map<number, TickerHandle>();
    for (const tr of tickerRows) {
      tickerMap.set(tr.id, TickerHandle.fromRow(this._supabase, tr));
    }

    const indicatorMap = new Map<number, IndicatorHandle>();
    for (const ir of indicatorRows) {
      const ticker = ir.ticker_id ? (tickerMap.get(ir.ticker_id) ?? null) : null;
      indicatorMap.set(ir.id, IndicatorHandle.fromRow(this._supabase, ir, ticker, this._config));
    }

    const signalMap = new Map<number, SignalHandle>();
    for (const sr of signalRows) {
      signalMap.set(
        sr.id,
        SignalHandle.fromRow(
          this._supabase,
          sr,
          indicatorMap.get(sr.indicator_id_1)!,
          indicatorMap.get(sr.indicator_id_2)!,
          this._config,
        ),
      );
    }

    const allocationHandleMap = new Map<number, AllocationHandle>();
    for (const ar of allocationRows) {
      const handle = AllocationHandle.fromRow(this._supabase, ar);
      allocationHandleMap.set(ar.id, handle);
      this._allocationMap.set(ar.id, handle);
    }

    // Reconstruct rules
    this._rules = def.rules.map((rule) => ({
      when: rule.signalIds.length > 0 ? rule.signalIds.map((id) => signalMap.get(id)!) : undefined,
      hold: allocationHandleMap.get(rule.allocationId)!,
    }));

    this._resolved = stratRow;
    return stratRow;
  }

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

  private async _getLatestStrategySeriesDate(): Promise<string | null> {
    const row = await this.resolve();
    const { data, error } = await this._supabase
      .from('strategies_series')
      .select('trading_days!inner(date)')
      .eq('strategies_id', row.id)
      .order('trading_day_id', { ascending: false })
      .limit(1)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw error;
    return (data as unknown as { trading_days: { date: string } }).trading_days.date;
  }

  private async _ensureFresh(): Promise<void> {
    await this.resolve();
    const latestClosed = await this._getLatestClosedTradingDay();

    if (this._cachedAsOf === latestClosed) return;

    const latestSeries = await this._getLatestStrategySeriesDate();

    if (latestSeries === latestClosed) {
      this._cache = null;
      this._cachedAsOf = latestClosed;
      return;
    }

    if (!this._syncing) {
      this._syncing = this._sync(latestClosed).finally(() => {
        this._syncing = null;
      });
    }
    await this._syncing;

    this._cache = null;
    this._cachedAsOf = latestClosed;
  }

  private async _sync(latestClosed: string): Promise<void> {
    const row = await this.resolve();

    // Sync all signals and collect their series
    const signalSeries = new Map<number, Map<string, boolean>>();
    const allSignals = new Set<SignalHandle>();
    for (const rule of this._rules) {
      if (rule.when) rule.when.forEach((s) => allSignals.add(s));
    }

    await Promise.all(
      Array.from(allSignals).map(async (signal) => {
        const bars = await signal.series();
        const dateMap = new Map<string, boolean>();
        for (const bar of bars) dateMap.set(bar.date, bar.value === 1);
        signalSeries.set(signal.id, dateMap);
      }),
    );

    // Get all closed trading days
    const { data: tdRows, error: tdError } = await this._supabase
      .from('trading_days')
      .select('id, date')
      .lt('close', new Date().toISOString())
      .order('date', { ascending: true });

    if (tdError) throw tdError;

    const tradingDays = tdRows.map((td: { id: number; date: string }) => td.date);
    const dateToId = new Map<string, number>();
    for (const td of tdRows) dateToId.set(td.date, td.id);

    // Compute rebalance dates
    const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);

    // Build allocation index mapping
    const allocations: AllocationHandle[] = [];
    const allocIndexMap = new Map<number, number>();
    const rulesInput = this._rules.map((rule) => {
      let allocIdx = allocIndexMap.get(rule.hold.id);
      if (allocIdx === undefined) {
        allocIdx = allocations.length;
        allocations.push(rule.hold);
        allocIndexMap.set(rule.hold.id, allocIdx);
      }
      return {
        signalIds: (rule.when ?? []).map((s) => s.id),
        allocationIndex: allocIdx,
      };
    });

    // Evaluate
    const evalResult = evaluateStrategy(signalSeries, rulesInput, rebalanceDates, tradingDays);

    // Upsert to strategies_series
    const rows = Array.from(evalResult.entries())
      .filter(([date]) => dateToId.has(date) && date <= latestClosed)
      .map(([date, allocIdx]) => ({
        strategies_id: row.id,
        trading_day_id: dateToId.get(date)!,
        allocation_id: allocations[allocIdx].id,
      }));

    if (rows.length > 0) {
      const { error } = await this._supabase
        .from('strategies_series')
        .upsert(rows, { onConflict: 'strategies_id,trading_day_id' });
      if (error) throw error;
    }
  }

  private async _querySeriesFromDb(range?: DateRange): Promise<StrategyBar[]> {
    const row = await this.resolve();
    let query = this._supabase
      .from('strategies_series')
      .select('allocation_id, trading_days!inner(date)')
      .eq('strategies_id', row.id)
      .order('trading_day_id', { ascending: true });

    if (range?.from) query = query.gte('trading_days.date', range.from);
    if (range?.to) query = query.lte('trading_days.date', range.to);

    const { data, error } = await query;
    if (error) throw error;

    return (data as unknown as { allocation_id: number; trading_days: { date: string } }[]).map((r) => ({
      date: r.trading_days.date,
      allocation: this._allocationMap.get(r.allocation_id)!,
    }));
  }

  async series(range?: DateRange): Promise<StrategyBar[]> {
    await this._ensureFresh();
    if (this._cache && !range) return this._cache;
    const bars = await this._querySeriesFromDb(range);
    if (!range) this._cache = bars;
    return bars;
  }

  async value(date?: string): Promise<AllocationHandle | null> {
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
        .from('strategies_series')
        .select('allocation_id')
        .eq('strategies_id', row.id)
        .eq('trading_day_id', td.id)
        .single();

      if (error?.code === 'PGRST116') return null;
      if (error) throw error;
      return this._allocationMap.get(data.allocation_id) ?? null;
    }

    const { data, error } = await this._supabase
      .from('strategies_series')
      .select('allocation_id')
      .eq('strategies_id', row.id)
      .order('trading_day_id', { ascending: false })
      .limit(1)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw error;
    return this._allocationMap.get(data.allocation_id) ?? null;
  }

  async simulate(options: SimulateOptions): Promise<SimulationHandle> {
    const bars = await this.series({ from: options.from, to: options.to });
    if (bars.length === 0) {
      const capital = options.initialCapital ?? 100_000;
      return new SimulationHandle([], [], capital);
    }

    const prices = await this._fetchPricesForTickers(bars, options.from, options.to);
    const tradingDays = bars.map((b) => b.date);
    const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);
    const initialCapital = options.initialCapital ?? 100_000;

    const result = runSimulation(bars, prices, rebalanceDates, initialCapital);
    return new SimulationHandle(result.series, result.trades, initialCapital);
  }

  private async _fetchPricesForTickers(
    bars: StrategyBar[],
    from: string,
    to: string,
  ): Promise<Record<string, Record<string, number>>> {
    const tickerMap = new Map<string, TickerHandle>();
    for (const bar of bars) {
      for (const [ticker] of bar.allocation.holdings) {
        if (!tickerMap.has(ticker.symbol)) {
          tickerMap.set(ticker.symbol, ticker);
        }
      }
    }

    const entries = await Promise.all(
      Array.from(tickerMap.entries()).map(async ([symbol, ticker]) => {
        const priceIndicator = new IndicatorHandle(
          this._supabase,
          { type: 'Price', ticker, lookback: 0, delay: 0, unit: null, threshold: null },
          this._config,
        );
        const priceBars = await priceIndicator.series({ from, to });
        const dateMap: Record<string, number> = {};
        for (const bar of priceBars) {
          dateMap[bar.date] = bar.value;
        }
        return [symbol, dateMap] as const;
      }),
    );

    return Object.fromEntries(entries);
  }
}
