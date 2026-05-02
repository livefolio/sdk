import type { DailyBar, DateRange } from '../handles/indicator';
import type { StrategyDefinition, StrategySeriesEntry, StrategyReferenceData } from './types';

export interface StorageProvider {
  tickers: {
    upsert(symbol: string, leverage: number): Promise<{ id: number }>;
    findOrCreate(symbol: string, leverage: number): Promise<{ id: number }>;
  };

  indicators: {
    upsert(identity: {
      type: string;
      tickerId: number | null;
      lookback: number;
      delay: number;
      unit: string | null;
      threshold: number | null;
    }): Promise<{ id: number }>;
    findOrCreate(identity: {
      type: string;
      tickerId: number | null;
      lookback: number;
      delay: number;
      unit: string | null;
      threshold: number | null;
    }): Promise<{ id: number }>;
    getSeries(indicatorId: number, range?: DateRange): Promise<DailyBar[]>;
    writeSeries(indicatorId: number, bars: DailyBar[], opts?: { metadata?: unknown }): Promise<void>;
    getLatestSeriesDate(indicatorId: number): Promise<string | null>;
    getValue(indicatorId: number, date?: string): Promise<number | null>;
    getLatestBar(indicatorId: number): Promise<{ date: string; value: number; metadata: unknown } | null>;
  };

  signals: {
    upsert(identity: {
      indicatorId1: number;
      indicatorId2: number;
      comparison: string;
      tolerance: number;
    }): Promise<{ id: number }>;
    findOrCreate(identity: {
      indicatorId1: number;
      indicatorId2: number;
      comparison: string;
      tolerance: number;
    }): Promise<{ id: number }>;
    getSeries(signalId: number, range?: DateRange): Promise<DailyBar[]>;
    writeSeries(signalId: number, bars: DailyBar[]): Promise<void>;
    getLatestSeriesDate(signalId: number): Promise<string | null>;
    getLastValue(signalId: number): Promise<number | null>;
  };

  allocations: {
    findOrCreate(holdings: Record<string, number>): Promise<{ id: number }>;
  };

  strategies: {
    create(definition: StrategyDefinition): Promise<{ id: number }>;
    getSeries(strategyId: number, range?: DateRange): Promise<StrategySeriesEntry[]>;
    writeSeries(strategyId: number, entries: StrategySeriesEntry[]): Promise<void>;
    getLatestSeriesDate(strategyId: number): Promise<string | null>;
    getLatestAllocationId(strategyId: number): Promise<number | null>;
    resolveReference(linkId: string): Promise<StrategyReferenceData>;
  };

  tradingDays: {
    getRange(range?: DateRange): Promise<string[]>;
    getLatestClosed(): Promise<string | null>;
  };
}
