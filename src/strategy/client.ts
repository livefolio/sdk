import type { TypedSupabaseClient } from '../types';
import type {
  Indicator,
  IndicatorEvaluation,
  Signal,
  Strategy,
  StrategyEvaluation,
  StrategyModule,
  BacktestOptions,
  BacktestResult,
  Ticker,
  Unit,
  Comparison,
  IndicatorType,
} from './types';
import {
  evaluate as evaluatePure,
  evaluateIndicator as evaluateIndicatorPure,
  evaluateSignal as evaluateSignalPure,
  evaluateAllocation as evaluateAllocationPure,
  getEvaluationDate as getEvaluationDatePure,
  signalKey,
  indicatorKey,
} from './evaluate';
import { extractSymbols as extractSymbolsPure } from './symbols';
import { createMarket } from '../market/client';

// ---------------------------------------------------------------------------
// Row → domain mapping helpers
// ---------------------------------------------------------------------------

function mapTicker(row: { symbol: string; leverage: number }): Ticker {
  return { symbol: row.symbol, leverage: row.leverage };
}

function mapIndicator(row: {
  type: string;
  tickers: { symbol: string; leverage: number } | null;
  lookback: number;
  delay: number;
  unit: string | null;
  threshold: number | null;
}): Indicator {
  return {
    type: row.type as IndicatorType,
    ticker: row.tickers ? mapTicker(row.tickers) : { symbol: '', leverage: 1 },
    lookback: row.lookback,
    delay: row.delay,
    unit: (row.unit as Unit) ?? null,
    threshold: row.threshold,
  };
}

function mapSignal(row: {
  id: number;
  indicator_1: {
    type: string;
    tickers: { symbol: string; leverage: number } | null;
    lookback: number;
    delay: number;
    unit: string | null;
    threshold: number | null;
  };
  indicator_2: {
    type: string;
    tickers: { symbol: string; leverage: number } | null;
    lookback: number;
    delay: number;
    unit: string | null;
    threshold: number | null;
  };
  comparison: string;
  tolerance: number;
}): Signal {
  return {
    left: mapIndicator(row.indicator_1),
    comparison: row.comparison as Comparison,
    right: mapIndicator(row.indicator_2),
    tolerance: row.tolerance,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createStrategy(client: TypedSupabaseClient): StrategyModule {
  // Cast to any for new tables not yet in generated types.
  // Will be removed after regenerating database.types.ts.
  const db = client as any;
  const market = createMarket(client);

  // -----------------------------------------------------------------------
  // Private helpers (moved from public storage methods)
  // -----------------------------------------------------------------------

  async function fetchSignalStates(strategyId: number): Promise<Record<string, boolean>> {
    const { data: nsRows, error: nsErr } = await db
      .from('named_signals')
      .select(`
        signal_id,
        signals:signal_id (
          id,
          indicator_1:indicator_id_1 ( type, tickers:ticker_id ( symbol, leverage ), lookback, delay, unit, threshold ),
          indicator_2:indicator_id_2 ( type, tickers:ticker_id ( symbol, leverage ), lookback, delay, unit, threshold ),
          comparison,
          tolerance
        )
      `)
      .eq('strategy_id', strategyId);

    if (nsErr || !nsRows || nsRows.length === 0) return {};

    const signalIds = nsRows.map((r: any) => r.signal_id);
    const { data: evalRows, error: evalErr } = await client
      .from('signal_evaluations')
      .select('signal_id, result, trading_day_id')
      .in('signal_id', signalIds)
      .order('trading_day_id', { ascending: false });

    if (evalErr || !evalRows) return {};

    const latestBySignalId = new Map<number, boolean>();
    for (const row of evalRows as any[]) {
      if (!latestBySignalId.has(row.signal_id)) {
        latestBySignalId.set(row.signal_id, row.result);
      }
    }

    const result: Record<string, boolean> = {};
    for (const nsRow of nsRows as any[]) {
      const signal = mapSignal(nsRow.signals);
      const key = signalKey(signal);
      const val = latestBySignalId.get(nsRow.signal_id);
      if (val !== undefined) {
        result[key] = val;
      }
    }

    return result;
  }

  async function fetchSignalStatesForDay(
    strategyId: number,
    tradingDayId: number,
  ): Promise<Record<string, boolean>> {
    const { data: nsRows, error: nsErr } = await db
      .from('named_signals')
      .select(`
        signal_id,
        signals:signal_id (
          id,
          indicator_1:indicator_id_1 ( type, tickers:ticker_id ( symbol, leverage ), lookback, delay, unit, threshold ),
          indicator_2:indicator_id_2 ( type, tickers:ticker_id ( symbol, leverage ), lookback, delay, unit, threshold ),
          comparison,
          tolerance
        )
      `)
      .eq('strategy_id', strategyId);

    if (nsErr || !nsRows || nsRows.length === 0) return {};

    const signalIds = nsRows.map((r: any) => r.signal_id);
    const { data: evalRows, error: evalErr } = await client
      .from('signal_evaluations')
      .select('signal_id, result')
      .in('signal_id', signalIds)
      .eq('trading_day_id', tradingDayId);

    if (evalErr || !evalRows) return {};

    const signalIdToResult = new Map<number, boolean>();
    for (const row of evalRows as any[]) {
      signalIdToResult.set(row.signal_id, row.result);
    }

    const result: Record<string, boolean> = {};
    for (const nsRow of nsRows as any[]) {
      const signal = mapSignal(nsRow.signals);
      const key = signalKey(signal);
      const val = signalIdToResult.get(nsRow.signal_id);
      if (val !== undefined) {
        result[key] = val;
      }
    }

    return result;
  }

  async function fetchIndicatorKeyMap(strategyId: number): Promise<Map<string, number>> {
    const { data: nsRows, error: nsErr } = await db
      .from('named_signals')
      .select(`
        signals:signal_id (
          indicator_1:indicator_id_1 ( id, type, tickers:ticker_id ( symbol, leverage ), lookback, delay, unit, threshold ),
          indicator_2:indicator_id_2 ( id, type, tickers:ticker_id ( symbol, leverage ), lookback, delay, unit, threshold )
        )
      `)
      .eq('strategy_id', strategyId);

    if (nsErr || !nsRows || nsRows.length === 0) return new Map();

    const keyToId = new Map<string, number>();
    for (const nsRow of nsRows as any[]) {
      for (const ind of [nsRow.signals.indicator_1, nsRow.signals.indicator_2]) {
        const key = indicatorKey(mapIndicator(ind));
        if (!keyToId.has(key)) {
          keyToId.set(key, ind.id);
        }
      }
    }

    return keyToId;
  }

  async function fetchIndicatorEvaluationsForDay(
    strategyId: number,
    tradingDayId: number,
  ): Promise<Record<string, IndicatorEvaluation>> {
    const keyToId = await fetchIndicatorKeyMap(strategyId);
    if (keyToId.size === 0) return {};

    const indicatorIds = [...keyToId.values()];

    const { data: evalRows, error: evalErr } = await db
      .from('indicator_evaluations')
      .select('indicator_id, value, metadata, trading_days!inner(post)')
      .in('indicator_id', indicatorIds)
      .eq('trading_day_id', tradingDayId);

    if (evalErr || !evalRows) return {};

    const byIndicatorId = new Map<number, { value: number; metadata: unknown; post: string }>();
    for (const row of evalRows as any[]) {
      byIndicatorId.set(row.indicator_id, {
        value: Number(row.value),
        metadata: row.metadata,
        post: row.trading_days.post,
      });
    }

    const result: Record<string, IndicatorEvaluation> = {};
    for (const [key, id] of keyToId) {
      const entry = byIndicatorId.get(id);
      if (entry) {
        result[key] = {
          timestamp: entry.post,
          value: entry.value,
          ...(entry.metadata != null ? { metadata: entry.metadata } : {}),
        };
      }
    }

    return result;
  }

  async function fetchIndicatorMetadata(strategyId: number): Promise<Record<string, unknown>> {
    const keyToId = await fetchIndicatorKeyMap(strategyId);
    if (keyToId.size === 0) return {};

    const indicatorIds = [...keyToId.values()];

    const { data: evalRows, error: evalErr } = await db
      .from('indicator_evaluations')
      .select('indicator_id, metadata, trading_day_id')
      .in('indicator_id', indicatorIds)
      .order('trading_day_id', { ascending: false });

    if (evalErr || !evalRows) return {};

    const latestByIndicatorId = new Map<number, unknown>();
    for (const row of evalRows as any[]) {
      if (!latestByIndicatorId.has(row.indicator_id) && row.metadata != null) {
        latestByIndicatorId.set(row.indicator_id, row.metadata);
      }
    }

    const result: Record<string, unknown> = {};
    for (const [key, id] of keyToId) {
      const meta = latestByIndicatorId.get(id);
      if (meta !== undefined) {
        result[key] = meta;
      }
    }

    return result;
  }

  async function storeResult(
    strategy: Strategy,
    result: StrategyEvaluation,
  ): Promise<void> {
    // Resolve strategy_id for indicator key → DB ID mapping
    const { data: stratRow } = await client
      .from('strategies')
      .select('id')
      .eq('link_id', strategy.linkId)
      .limit(1)
      .maybeSingle();

    const signalResults = Object.entries(result.signals).map(([_key, sigResult]) => {
      const ns = strategy.namedSignals.find(
        (ns) => signalKey(ns.signal) === _key,
      );
      return { name: ns?.name ?? _key, result: sigResult };
    });

    // Map indicator keys to database IDs
    const keyToId = stratRow ? await fetchIndicatorKeyMap(stratRow.id) : new Map<string, number>();
    const indicatorResults = Object.entries(result.indicators)
      .filter(([key]) => keyToId.has(key))
      .map(([key, indResult]) => ({
        indicatorId: keyToId.get(key)!,
        value: indResult.value,
        metadata: indResult.metadata ?? null,
      }));

    const { error } = await db.rpc('upsert_evaluation', {
      p_link_id: strategy.linkId,
      p_allocation_name: result.allocation.name,
      p_signal_results: signalResults,
      p_indicator_results: indicatorResults,
      p_evaluated_at: result.evaluatedAt.toISOString(),
    });

    if (error) throw new Error(`Failed to store evaluation: ${error.message}`);
  }

  // -----------------------------------------------------------------------
  // Module
  // -----------------------------------------------------------------------

  return {
    // ----- Retrieval -----

    async get(linkId: string): Promise<Strategy | null> {
      const { data, error } = await client.functions.invoke('strategy', {
        body: { linkId },
      });
      if (error || !data) return null;
      return data as Strategy;
    },

    async getMany(linkIds: string[]): Promise<Record<string, Strategy>> {
      if (linkIds.length === 0) return {};

      const result: Record<string, Strategy> = {};
      // Use parallel fetches
      const promises = linkIds.map(async (id) => {
        const strategy = await this.get(id);
        if (strategy) result[id] = strategy;
      });
      await Promise.all(promises);
      return result;
    },

    // ----- Cache-through evaluation -----

    async evaluate(strategy: Strategy, at: Date): Promise<StrategyEvaluation> {
      // 1. Fetch series + resolve strategy_id in parallel
      const symbols = extractSymbolsPure(strategy);
      const [batchSeries, stratRow] = await Promise.all([
        market.getBatchSeries(symbols),
        client
          .from('strategies')
          .select('id')
          .eq('link_id', strategy.linkId)
          .limit(1)
          .maybeSingle()
          .then(({ data }) => data),
      ]);

      // 2. Build options for pure evaluation
      const options = { at, batchSeries };
      const evaluationDate = getEvaluationDatePure(strategy.trading, options);

      // 4. No DB strategy → pure eval
      if (!stratRow) return evaluatePure(strategy, options);

      // 5. Resolve trading_day_id
      const { data: tdRow } = await db
        .from('trading_days')
        .select('id')
        .lte('post', evaluationDate.toISOString())
        .order('post', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!tdRow) return evaluatePure(strategy, options);

      // 6. Check cache
      const { data: cacheRow } = await db
        .from('strategy_evaluations')
        .select('allocation_id, evaluated_at')
        .eq('strategy_id', stratRow.id)
        .eq('trading_day_id', tdRow.id)
        .limit(1)
        .maybeSingle();

      if (cacheRow) {
        // CACHE HIT — reconstruct result
        const { data: allocRow } = await db
          .from('allocations')
          .select('name')
          .eq('id', cacheRow.allocation_id)
          .limit(1)
          .maybeSingle();

        const namedAlloc = strategy.allocations.find(na => na.name === allocRow?.name)
          ?? strategy.allocations[strategy.allocations.length - 1];

        const [signals, indicators] = await Promise.all([
          fetchSignalStatesForDay(stratRow.id, tdRow.id),
          fetchIndicatorEvaluationsForDay(stratRow.id, tdRow.id),
        ]);
        return {
          allocation: {
            name: namedAlloc.name,
            holdings: namedAlloc.allocation.holdings,
          },
          evaluatedAt: new Date(cacheRow.evaluated_at),
          signals,
          indicators,
        };
      }

      // 7. CACHE MISS — fetch prior state, evaluate, store
      const [prevSignals, prevMeta] = await Promise.all([
        fetchSignalStates(stratRow.id),
        fetchIndicatorMetadata(stratRow.id),
      ]);

      const result = evaluatePure(strategy, {
        ...options,
        previousSignalStates: prevSignals,
        previousIndicatorMetadata: prevMeta,
      });

      // Store (non-blocking)
      storeResult(strategy, result).catch(err =>
        console.error('Failed to store evaluation:', err),
      );

      return result;
    },

    // ----- Pure evaluation (delegate to evaluate.ts) -----

    evaluateIndicator: evaluateIndicatorPure,
    evaluateSignal: evaluateSignalPure,
    evaluateAllocation: evaluateAllocationPure,
    getEvaluationDate: getEvaluationDatePure,

    // ----- Utilities -----

    extractSymbols: extractSymbolsPure,

    async backtest(_strategy: Strategy, _options: BacktestOptions): Promise<BacktestResult> {
      throw new Error('Not implemented');
    },
  };
}
