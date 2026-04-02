import { nanoid } from 'nanoid';
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
import type { SimulateOptions, FinalState } from '../backtest/types';

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
        return [TickerHandle.fromResolved(this._storage, 0, symbol, leverage), weight];
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
      this._syncing = this._sync(latestClosed).finally(() => {
        this._syncing = null;
      });
    }
    await this._syncing;

    this._cache = null;
    this._cachedAsOf = latestClosed;
  }

  private async _sync(latestClosed: string): Promise<void> {
    const { id } = await this.resolve();

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

    // Get all trading days
    const tradingDays = await this._storage.tradingDays.getRange();

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

    // Write strategy series
    const entries: StrategySeriesEntry[] = Array.from(evalResult.entries())
      .filter(([date]) => date <= latestClosed)
      .map(([date, allocIdx]) => ({
        date,
        allocationId: allocations[allocIdx]!.id,
      }));

    if (entries.length > 0) {
      await this._storage.strategies.writeSeries(id, entries);
    }
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
      const price = prices[ticker.symbol]?.[lastDate];
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

    return new SimulationHandle(result.series, result.trades, options.portfolio, finalState);
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
        return [symbol, dateMap] as const;
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
