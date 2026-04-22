import { customAlphabet } from 'nanoid';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';
import type { TradingFreq, StrategySeriesEntry } from '../providers/types';
import { SignalHandle } from './signal';
import { AllocationHandle } from './allocation';
import { TickerHandle } from './ticker';
import { IndicatorHandle } from './indicator';
import type { DateRange } from './indicator';
import { evaluateStrategy, computeRebalanceDates } from '../computations/strategy';
import { runSimulation } from '../backtest/simulate';
import { SimulationHandle } from '../backtest/types';
import type {
  SimulateOptions,
  FinalState,
  LiveEvaluator,
  StrategyLiveState,
  LiveRuleState,
  LiveSignalState,
} from '../backtest/types';

const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 21);

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

  private _storage: StorageProvider;
  private _market: MarketProvider;
  private _resolvedId: number | null = null;
  private _resolvedLinkId: string | null = null;
  private _resolving: Promise<{ id: number }> | null = null;
  private _allocationMap: Map<number, AllocationHandle> = new Map();

  private _cache: StrategyBar[] | null = null;
  private _cachedAsOf: string | null = null;
  private _syncing: Promise<void> | null = null;

  constructor(storage: StorageProvider, market: MarketProvider, optionsOrLinkId: StrategyOptions | string) {
    this._storage = storage;
    this._market = market;

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
      const lastRule = opts.rules[opts.rules.length - 1]!;
      if (lastRule.when && lastRule.when.length > 0) {
        throw new Error('Last rule must be a fallback (no when clause)');
      }
      for (let i = 0; i < opts.rules.length - 1; i++) {
        const rule = opts.rules[i]!;
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
    if (this._resolvedId == null) throw new Error('StrategyHandle not yet resolved. Call resolve() first.');
    return this._resolvedId;
  }

  get link(): string {
    if (this._resolvedLinkId == null) throw new Error('StrategyHandle not yet resolved. Call resolve() first.');
    return this._resolvedLinkId;
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

  marketSymbols(): string[] {
    const set = new Set<string>();
    for (const rule of this._rules) {
      for (const [ticker] of rule.hold.holdings) {
        if (ticker.symbol !== 'CASHX') set.add(ticker.symbol);
      }
      for (const signal of rule.when ?? []) {
        for (const ind of [signal.indicator1, signal.indicator2]) {
          if (ind.ticker !== null && ind.ticker.symbol !== 'CASHX') set.add(ind.ticker.symbol);
          if (ind.type === 'VIX') set.add('^VIX');
          if (ind.type === 'VIX3M') set.add('^VIX3M');
        }
      }
    }
    return Array.from(set).sort();
  }

  async resolve(): Promise<{ id: number }> {
    if (this._resolvedId != null) return { id: this._resolvedId };
    if (!this._resolving) {
      this._resolving =
        this._linkId !== null && this._name === null ? this._doResolveReference() : this._doResolveCreate();
    }
    return this._resolving;
  }

  private async _doResolveCreate(): Promise<{ id: number }> {
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

    const linkId = nanoid();
    const result = await this._storage.strategies.create({
      linkId,
      name: this._name!,
      freq: this._freq,
      offset: this._offset,
      rules: this._rules.map((rule) => ({
        signalIds: (rule.when ?? []).map((s) => s.id),
        allocationId: rule.hold.id,
      })),
    });

    this._resolvedId = result.id;
    this._resolvedLinkId = linkId;

    for (const rule of this._rules) {
      this._allocationMap.set(rule.hold.id, rule.hold);
    }

    return result;
  }

  private async _doResolveReference(): Promise<{ id: number }> {
    const ref = await this._storage.strategies.resolveReference(this._linkId!);
    this._resolvedId = ref.id;
    this._resolvedLinkId = this._linkId!;
    this._name = ref.name;
    this._freq = ref.freq;
    this._offset = ref.offset;

    // Build handles bottom-up from reference data
    const tickerMap = new Map<number, TickerHandle>();
    for (const t of ref.rules.tickers) {
      tickerMap.set(t.id, TickerHandle.fromResolved(this._storage, t.id, t.symbol, t.leverage));
    }

    const indicatorMap = new Map<number, IndicatorHandle>();
    for (const ind of ref.rules.indicators) {
      const ticker = ind.tickerId ? (tickerMap.get(ind.tickerId) ?? null) : null;
      indicatorMap.set(
        ind.id,
        IndicatorHandle.fromResolved(this._storage, this._market, ind.id, {
          type: ind.type,
          ticker,
          lookback: ind.lookback,
          delay: ind.delay,
          unit: ind.unit,
          threshold: ind.threshold,
        }),
      );
    }

    const signalMap = new Map<number, SignalHandle>();
    for (const sig of ref.rules.signals) {
      signalMap.set(
        sig.id,
        SignalHandle.fromResolved(this._storage, this._market, sig.id, {
          indicator1: indicatorMap.get(sig.indicatorId1)!,
          indicator2: indicatorMap.get(sig.indicatorId2)!,
          comparison: sig.comparison,
          tolerance: sig.tolerance,
        }),
      );
    }

    const allocationHandleMap = new Map<number, AllocationHandle>();
    for (const alloc of ref.rules.allocations) {
      const holdings: [TickerHandle, number][] = Object.entries(alloc.holdings).map(([key, weight]) => {
        const match = key.match(/^(.+)\?L=(.+)$/);
        const symbol = match ? match[1]! : key;
        const leverage = match ? Number(match[2]) : 1;
        return [new TickerHandle(this._storage, symbol, leverage), weight];
      });
      const handle = AllocationHandle.fromResolved(this._storage, alloc.id, holdings);
      allocationHandleMap.set(alloc.id, handle);
      this._allocationMap.set(alloc.id, handle);
    }

    // Reconstruct rules
    this._rules = ref.rules.definition.map((rule) => ({
      when: rule.signalIds && rule.signalIds.length > 0 ? rule.signalIds.map((id) => signalMap.get(id)!) : undefined,
      hold: allocationHandleMap.get(rule.allocationId)!,
    }));

    return { id: ref.id };
  }

  private async _getLatestClosedTradingDay(): Promise<string> {
    const date = await this._storage.tradingDays.getLatestClosed();
    if (!date) throw new Error('No closed trading days found');
    return date;
  }

  private async _getLatestStrategySeriesDate(): Promise<string | null> {
    const { id } = await this.resolve();
    return this._storage.strategies.getLatestSeriesDate(id);
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
      this._syncing = this._sync(latestClosed)
        .catch((err) => {
          console.warn('[sdk] strategy sync failed, using stored data:', err);
        })
        .finally(() => {
          this._syncing = null;
        });
    }
    await this._syncing;

    this._cache = null;
    this._cachedAsOf = latestClosed;
  }

  private async _sync(latestClosed: string): Promise<void> {
    const { id } = await this.resolve();
    const { entries } = await this._evaluate(latestClosed);
    if (entries.length > 0) {
      await this._storage.strategies.writeSeries(id, entries);
    }
  }

  /**
   * Pure evaluate — runs the same pipeline as _sync but returns the computed
   * evaluation instead of persisting. Used by both _sync (post-close write
   * path) and the public preview methods (pre-close read-only path).
   *
   * When `overrides` is `undefined` we take the write path — syncing signals
   * through storage as normal. When `overrides` is provided (even an empty
   * map) we take the read-only preview path: historical signal bars come
   * straight from storage, today's bar is computed in-memory via
   * `signal.computeAt(date, overrides, prevBool)`, and nothing is written.
   *
   * Incremental path: when a strategy checkpoint exists (`getLatestSeriesDate`
   * returns non-null), only the window (lastDate, limitDate] is processed.
   * The current allocation is carried forward from `getLatestAllocationId`.
   * Bootstrap: when no checkpoint exists, falls back to `_evaluateCold` which
   * runs the full-history evaluation.
   */
  private async _evaluate(
    limitDate: string,
    overrides?: Record<string, number>,
  ): Promise<{ allocations: AllocationHandle[]; entries: StrategySeriesEntry[] }> {
    const { id } = await this.resolve();
    const lastDate = await this._storage.strategies.getLatestSeriesDate(id);

    const tradingDays = await this._storage.tradingDays.getRange();
    const limitIdx = tradingDays.indexOf(limitDate);

    // Build the allocation index map exactly once per call.
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

    // Bootstrap: no checkpoint yet → fall back to full history compute.
    if (lastDate === null) {
      return this._evaluateCold(limitDate, overrides, rulesInput, allocations, tradingDays);
    }

    const lastAllocId = await this._storage.strategies.getLatestAllocationId(id);

    // Incremental window: (lastDate, limitDate], bounded by tradingDays.
    const startIdx = tradingDays.indexOf(lastDate) + 1;
    const newDays = tradingDays.slice(startIdx, limitIdx + 1);
    if (newDays.length === 0) return { allocations, entries: [] };

    // Build signal bar maps only for the new window.
    const allSignals = new Set<SignalHandle>();
    for (const rule of this._rules) if (rule.when) rule.when.forEach((s) => allSignals.add(s));
    const signalSeries = new Map<number, Map<string, boolean>>();
    await Promise.all(
      Array.from(allSignals).map(async (signal) => {
        const bars =
          overrides === undefined
            ? await signal.series({ from: newDays[0]!, to: limitDate })
            : await this._storage.signals.getSeries(signal.id, { from: newDays[0]!, to: limitDate });
        const dateMap = new Map<string, boolean>();
        for (const bar of bars) dateMap.set(bar.date, bar.value === 1);
        if (overrides !== undefined) {
          const prevDateIdx = startIdx - 1 >= 0 ? tradingDays[startIdx - 1] : undefined;
          const prevBool = prevDateIdx !== undefined ? (await signal.value(prevDateIdx)) === 1 : null;
          const todayValue = await signal.computeAt(limitDate, overrides, prevBool);
          if (todayValue !== null) dateMap.set(limitDate, todayValue);
        }
        signalSeries.set(signal.id, dateMap);
      }),
    );

    const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);

    // Walk new days, carrying forward `current` from the checkpoint allocation.
    const entries: StrategySeriesEntry[] = [];
    let current: number | undefined = lastAllocId !== null ? (allocIndexMap.get(lastAllocId) ?? undefined) : undefined;

    for (const date of newDays) {
      if (rebalanceDates.has(date)) {
        for (const rule of rulesInput) {
          if (rule.signalIds.length === 0) {
            current = rule.allocationIndex;
            break;
          }
          const allTrue = rule.signalIds.every((sid) => signalSeries.get(sid)?.get(date) ?? false);
          if (allTrue) {
            current = rule.allocationIndex;
            break;
          }
        }
      }
      if (current !== undefined) {
        entries.push({ date, allocationId: allocations[current]!.id });
      }
    }

    return { allocations, entries };
  }

  // Renamed body of the old _evaluate — used only for first-ever evaluate (bootstrap).
  private async _evaluateCold(
    limitDate: string,
    overrides: Record<string, number> | undefined,
    rulesInput: { signalIds: number[]; allocationIndex: number }[],
    allocations: AllocationHandle[],
    tradingDays: string[],
  ): Promise<{ allocations: AllocationHandle[]; entries: StrategySeriesEntry[] }> {
    const allSignals = new Set<SignalHandle>();
    for (const rule of this._rules) if (rule.when) rule.when.forEach((s) => allSignals.add(s));
    const signalSeries = new Map<number, Map<string, boolean>>();

    if (overrides === undefined) {
      // Normal (post-close) path: sync signals through storage, may write.
      await Promise.all(
        Array.from(allSignals).map(async (signal) => {
          const bars = await signal.series();
          const dateMap = new Map<string, boolean>();
          for (const bar of bars) dateMap.set(bar.date, bar.value === 1);
          signalSeries.set(signal.id, dateMap);
        }),
      );
    } else {
      // Preview (pre-close, no-write) path: read historical from storage, then
      // compute today's signal value in-memory via computeAt. No writes anywhere.
      //
      // Find the trading day immediately before limitDate so we can pass its
      // in-memory boolean as prevBool to computeAt (hysteresis).
      const limitIdx = tradingDays.indexOf(limitDate);
      const prevDate = limitIdx > 0 ? tradingDays[limitIdx - 1] : undefined;

      await Promise.all(
        Array.from(allSignals).map(async (signal) => {
          // Read all historical signal bars from storage (pure read).
          const historicalBars = await this._storage.signals.getSeries(signal.id);
          const dateMap = new Map<string, boolean>();
          for (const bar of historicalBars) dateMap.set(bar.date, bar.value === 1);

          // Look up yesterday's boolean from the in-memory map (avoids stale
          // storage read for hysteresis on the preview path).
          const prevBool = prevDate !== undefined ? (dateMap.get(prevDate) ?? null) : null;

          const todayValue = await signal.computeAt(limitDate, overrides, prevBool);
          if (todayValue !== null) {
            dateMap.set(limitDate, todayValue);
          }

          signalSeries.set(signal.id, dateMap);
        }),
      );
    }

    const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);
    const evalResult = evaluateStrategy(signalSeries, rulesInput, rebalanceDates, tradingDays);
    const entries: StrategySeriesEntry[] = Array.from(evalResult.entries())
      .filter(([date]) => date <= limitDate)
      .map(([date, allocIdx]) => ({ date, allocationId: allocations[allocIdx]!.id }));
    return { allocations, entries };
  }

  private async _querySeriesFromDb(range?: DateRange): Promise<StrategyBar[]> {
    const { id } = await this.resolve();
    const entries = await this._storage.strategies.getSeries(id, range);
    return entries.map((e) => ({
      date: e.date,
      allocation: this._allocationMap.get(e.allocationId)!,
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
    const bars = date ? await this._querySeriesFromDb({ from: date, to: date }) : await this._querySeriesFromDb();
    if (bars.length === 0) return null;
    return date ? bars[0]!.allocation : bars[bars.length - 1]!.allocation;
  }

  async simulate(options: SimulateOptions): Promise<SimulationHandle> {
    const bars = await this.series({ from: options.from, to: options.to });
    if (bars.length === 0) {
      return new SimulationHandle([], [], options.portfolio);
    }

    const prices = await this._fetchPricesForTickers(bars, options.from, options.to);
    const tradingDays = bars.map((b) => b.date);
    const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);

    // Force day 1 rebalance so existing positions align to strategy
    rebalanceDates.add(bars[0]!.date);

    const result = runSimulation(bars, prices, rebalanceDates, options.portfolio);

    // Build finalState for live push support
    const lastBar = bars[bars.length - 1]!;
    const lastDate = lastBar.date;
    const lastAllocation = lastBar.allocation;

    // leveragedPrices: keyed as "symbol:leverage", values are the leveraged prices from _fetchPricesForTickers
    const leveragedPrices: Record<string, number> = {};
    for (const [ticker, _weight] of lastAllocation.holdings) {
      if (ticker.symbol === 'CASHX') continue;
      const key = `${ticker.symbol}:${ticker.leverage}`;
      const price = prices[key]?.[lastDate];
      if (price != null) leveragedPrices[key] = price;
    }

    // closePrices: raw (unleveraged) close prices for computing real returns
    const closePrices: Record<string, number> = {};
    await this._fetchRawClosePrices(bars, lastDate, closePrices);

    const finalState: FinalState = {
      portfolio: result.finalPortfolio,
      allocation: lastAllocation,
      closePrices,
      leveragedPrices,
    };

    const liveEvaluator: LiveEvaluator = {
      previewLiveState: (date, overrides) => this.previewLiveState(date, overrides),
    };
    return new SimulationHandle(result.series, result.trades, options.portfolio, finalState, liveEvaluator);
  }

  /**
   * Preview the allocation this strategy would produce for `date` if today
   * closed at the provided raw quote prices. Does NOT write to strategies_series,
   * signals_series, or indicators_series. Safe to call before market close.
   *
   * @param date - The trading day to preview (must be in tradingDays.getRange()).
   * @param overrides - Raw (unleveraged) live prices keyed by market symbol.
   *   Symbols absent from this map fall back to the last stored value
   *   (see `IndicatorHandle._resolveRawBars`).
   * @returns The AllocationHandle for `date`, or null if the strategy has no
   *   evaluable entry for that date.
   */
  async previewAllocation(date: string, overrides: Record<string, number>): Promise<AllocationHandle | null> {
    await this.resolve();

    const tradingDays = await this._storage.tradingDays.getRange();
    if (!tradingDays.includes(date)) {
      throw new Error(`previewAllocation: ${date} is not a trading day`);
    }

    const { allocations, entries } = await this._evaluate(date, overrides);

    const target = entries.find((e) => e.date === date);
    if (!target) return null;

    const alloc = allocations.find((a) => a.id === target.allocationId);
    return alloc ?? this._allocationMap.get(target.allocationId) ?? null;
  }

  /**
   * Read-only preview of the strategy's allocation series including `date`.
   * Returns stored historical allocations plus an in-memory bar at `date`
   * computed via the same overrides-based preview path as `previewAllocation`.
   *
   * @param date - Target trading day to splice in-memory.
   * @param overrides - Raw (unleveraged) quotes keyed by market symbol.
   * @param range - Optional filter applied to the returned bars.
   */
  async previewSeries(date: string, overrides: Record<string, number>, range?: DateRange): Promise<StrategyBar[]> {
    await this.resolve();

    const tradingDays = await this._storage.tradingDays.getRange();
    if (!tradingDays.includes(date)) {
      throw new Error(`previewSeries: ${date} is not a trading day`);
    }

    const { allocations, entries } = await this._evaluate(date, overrides);

    const allocById = new Map<number, AllocationHandle>();
    for (const a of allocations) allocById.set(a.id, a);
    for (const [id, a] of this._allocationMap) if (!allocById.has(id)) allocById.set(id, a);

    // When _evaluate returned only incremental entries (checkpoint path), fetch
    // stored history from the DB and prepend it so the caller gets the full series.
    const { id } = await this.resolve();
    const lastDate = await this._storage.strategies.getLatestSeriesDate(id);
    let storedBars: StrategyBar[] = [];
    if (lastDate !== null && entries.length > 0 && entries[0]!.date > (tradingDays[0] ?? '')) {
      // There may be stored history before the first entry — fetch it.
      const storedEntries = await this._storage.strategies.getSeries(id, { to: lastDate });
      storedBars = storedEntries.map((e) => ({
        date: e.date,
        allocation: allocById.get(e.allocationId) ?? this._allocationMap.get(e.allocationId)!,
      }));
    } else if (lastDate !== null && entries.length === 0) {
      // No new entries (e.g. limitDate === lastDate): return all stored history.
      const storedEntries = await this._storage.strategies.getSeries(id);
      storedBars = storedEntries.map((e) => ({
        date: e.date,
        allocation: allocById.get(e.allocationId) ?? this._allocationMap.get(e.allocationId)!,
      }));
    }

    const newBars: StrategyBar[] = entries.map((e) => ({
      date: e.date,
      allocation: allocById.get(e.allocationId)!,
    }));

    // Merge: stored history (excluding any dates already in newBars) + newBars.
    const newDates = new Set(newBars.map((b) => b.date));
    let bars: StrategyBar[] = [...storedBars.filter((b) => !newDates.has(b.date)), ...newBars];
    bars.sort((a, b) => a.date.localeCompare(b.date));

    if (range) {
      bars = bars.filter(
        (b) => (range.from === undefined || b.date >= range.from) && (range.to === undefined || b.date <= range.to),
      );
    }

    return bars;
  }

  /**
   * Full live strategy view at `date` under live-quote `overrides`: the active
   * allocation, the index of the rule that fired (or fallback), and per-rule
   * per-signal indicator values + truth. Computed entirely through the
   * overrides preview path — no writes to any `*_series` tables.
   *
   * Threshold indicators have their date suppressed (`null`) since their
   * synthetic series runs over every trading day in storage including future
   * dates and would report a far-future date for the last bar.
   */
  async previewLiveState(date: string, overrides: Record<string, number>): Promise<StrategyLiveState> {
    await this.resolve();

    const tradingDays = await this._storage.tradingDays.getRange();
    if (!tradingDays.includes(date)) {
      throw new Error(`previewLiveState: ${date} is not a trading day`);
    }

    const [{ allocations, entries }, rules] = await Promise.all([
      this._evaluate(date, overrides),
      Promise.all(
        this._rules.map(async (rule): Promise<LiveRuleState> => {
          const signalHandles = rule.when ?? [];
          const signals: LiveSignalState[] = await Promise.all(
            signalHandles.map(async (sig) => {
              const [i1Series, i2Series, sigSeries] = await Promise.all([
                sig.indicator1.previewSeries(date, overrides),
                sig.indicator2.previewSeries(date, overrides),
                sig.previewSeries(date, overrides),
              ]);
              const last1 = i1Series.at(-1);
              const last2 = i2Series.at(-1);
              const lastSig = sigSeries.at(-1);
              const i1IsThreshold = sig.indicator1.type === 'Threshold';
              const i2IsThreshold = sig.indicator2.type === 'Threshold';
              return {
                indicator1: {
                  value: last1?.value ?? null,
                  date: i1IsThreshold ? null : (last1?.date ?? null),
                },
                indicator2: {
                  value: last2?.value ?? null,
                  date: i2IsThreshold ? null : (last2?.date ?? null),
                },
                isTrue: lastSig?.value === 1,
              };
            }),
          );
          return { signals };
        }),
      ),
    ]);

    const target = entries.find((e) => e.date === date);
    const allocation = target
      ? (allocations.find((a) => a.id === target.allocationId) ?? this._allocationMap.get(target.allocationId) ?? null)
      : null;

    const fallbackIndex = this._rules.length - 1;
    let activeRuleIndex = fallbackIndex;
    if (target) {
      for (let r = 0; r < this._rules.length; r++) {
        if (this._rules[r]!.hold.id === target.allocationId) {
          activeRuleIndex = r;
          break;
        }
      }
    }

    return { allocation, activeRuleIndex, rules };
  }

  private async _fetchPricesForTickers(
    bars: StrategyBar[],
    from: string,
    to: string,
  ): Promise<Record<string, Record<string, number>>> {
    const tickerMap = new Map<string, TickerHandle>();
    for (const bar of bars) {
      for (const [ticker] of bar.allocation.holdings) {
        const key = `${ticker.symbol}:${ticker.leverage}`;
        if (!tickerMap.has(key)) {
          tickerMap.set(key, ticker);
        }
      }
    }

    const entries = await Promise.all(
      Array.from(tickerMap.entries()).map(async ([key, ticker]) => {
        const priceIndicator = new IndicatorHandle(this._storage, this._market, {
          type: 'Price',
          ticker,
          lookback: 0,
          delay: 0,
          unit: null,
          threshold: null,
        });
        const priceBars = await priceIndicator.series({ from, to });
        const dateMap: Record<string, number> = {};
        for (const bar of priceBars) {
          dateMap[bar.date] = bar.value;
        }
        return [key, dateMap] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  private async _fetchRawClosePrices(
    bars: StrategyBar[],
    lastDate: string,
    closePrices: Record<string, number>,
  ): Promise<void> {
    const symbols = new Set<string>();
    for (const bar of bars) {
      for (const [ticker] of bar.allocation.holdings) {
        if (ticker.symbol !== 'CASHX') symbols.add(ticker.symbol);
      }
    }

    await Promise.all(
      Array.from(symbols).map(async (symbol) => {
        const rawTicker = new TickerHandle(this._storage, symbol, 1);
        const priceIndicator = new IndicatorHandle(this._storage, this._market, {
          type: 'Price',
          ticker: rawTicker,
          lookback: 0,
          delay: 0,
          unit: null,
          threshold: null,
        });
        const priceBars = await priceIndicator.series({ from: lastDate, to: lastDate });
        if (priceBars.length > 0) {
          closePrices[symbol] = priceBars[0]!.value;
        }
      }),
    );
  }
}
