import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MarketProvider } from './v3/providers/market';
import type { StorageProvider } from './v3/providers/storage';
import type { StrategySeriesEntry } from './v3/providers/types';
import type { DailyBar } from './v3/handles/indicator';

interface YfinanceBar {
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface YfinanceFixture {
  symbol: string;
  range: { from: string; to: string };
  bars: YfinanceBar[];
}

export interface FixtureMarketProviderOptions {
  fixtureDir: string;
}

export class FixtureMarketProvider implements MarketProvider {
  private readonly fixtureDir: string;
  private readonly cache = new Map<string, DailyBar[]>();

  constructor(opts: FixtureMarketProviderOptions) {
    this.fixtureDir = opts.fixtureDir;
  }

  async fetchBars(symbol: string, from?: string): Promise<DailyBar[]> {
    let bars = this.cache.get(symbol);
    if (!bars) {
      bars = this.loadSymbol(symbol);
      this.cache.set(symbol, bars);
    }
    if (from === undefined) return bars;
    return bars.filter((b) => b.date >= from);
  }

  private loadSymbol(symbol: string): DailyBar[] {
    const path = join(this.fixtureDir, `${symbol}-2020-2024.json`);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch {
      throw new Error(`FixtureMarketProvider: no fixture for ${symbol} at ${path}`);
    }
    const parsed = JSON.parse(raw) as YfinanceFixture;
    return parsed.bars
      .map((b) => ({ date: b.t.slice(0, 10), value: b.close }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

export function tradingDaysFromBars(...allBars: DailyBar[][]): string[] {
  const set = new Set<string>();
  for (const bars of allBars) for (const b of bars) set.add(b.date);
  return [...set].sort();
}

const noop = async () => undefined;

export function makeInMemoryStorage(dates: string[]) {
  // Indicator rows keyed by `${indicatorId}::${date}`
  const rows = new Map<string, { value: number; metadata: unknown }>();
  const indicatorIds = new Map<string, number>();

  // Signal rows keyed by `${signalId}::${date}`
  const signalRows = new Map<string, number>();
  const signalIds = new Map<string, number>();

  // Strategy series keyed by `${strategyId}::${date}`
  const strategyRows = new Map<string, number>();

  // Allocation id tracking
  const allocationIds = new Map<string, number>();

  let nextId = 1;

  function identityKey(identity: object) {
    return JSON.stringify(identity);
  }

  return {
    rows,
    signalRows,
    strategyRows,
    storage: {
      tickers: {
        upsert: async () => ({ id: 1 }),
        findOrCreate: async () => ({ id: 1 }),
      },
      indicators: {
        upsert: noop,
        findOrCreate: async (identity: Parameters<StorageProvider['indicators']['findOrCreate']>[0]) => {
          const k = identityKey(identity);
          if (!indicatorIds.has(k)) indicatorIds.set(k, nextId++);
          return { id: indicatorIds.get(k)! };
        },
        getSeries: async (indicatorId: number, range?: { from?: string; to?: string }) => {
          const bars: { date: string; value: number }[] = [];
          for (const [k, v] of rows) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) !== indicatorId) continue;
            if (range?.from && d! < range.from) continue;
            if (range?.to && d! > range.to) continue;
            bars.push({ date: d!, value: v.value });
          }
          return bars.sort((a, b) => a.date.localeCompare(b.date));
        },
        writeSeries: async (
          indicatorId: number,
          bars: { date: string; value: number }[],
          opts?: { metadata?: unknown },
        ) => {
          for (const b of bars) rows.set(`${indicatorId}::${b.date}`, { value: b.value, metadata: null });
          if (opts?.metadata !== undefined && bars.length > 0) {
            const maxDate = bars.reduce((m, b) => (b.date > m ? b.date : m), bars[0]!.date);
            rows.set(`${indicatorId}::${maxDate}`, {
              value: rows.get(`${indicatorId}::${maxDate}`)!.value,
              metadata: opts.metadata,
            });
            for (const [k, v] of rows) {
              if (!k.startsWith(`${indicatorId}::`)) continue;
              const d = k.split('::')[1]!;
              if (d < maxDate && v.metadata != null) rows.set(k, { value: v.value, metadata: null });
            }
          }
        },
        getLatestSeriesDate: async (indicatorId: number) => {
          let max: string | null = null;
          for (const k of rows.keys()) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) === indicatorId && (max === null || d! > max)) max = d!;
          }
          return max;
        },
        getValue: async (indicatorId: number, date?: string) => {
          if (date) return rows.get(`${indicatorId}::${date}`)?.value ?? null;
          let max: string | null = null;
          for (const k of rows.keys()) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) === indicatorId && (max === null || d! > max)) max = d!;
          }
          return max ? (rows.get(`${indicatorId}::${max}`)?.value ?? null) : null;
        },
        getLatestBar: async (indicatorId: number) => {
          let max: string | null = null;
          for (const k of rows.keys()) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) === indicatorId && (max === null || d! > max)) max = d!;
          }
          if (!max) return null;
          const row = rows.get(`${indicatorId}::${max}`)!;
          return { date: max, value: row.value, metadata: row.metadata };
        },
      },
      signals: {
        upsert: noop,
        findOrCreate: async (identity: Parameters<StorageProvider['signals']['findOrCreate']>[0]) => {
          const k = identityKey(identity);
          if (!signalIds.has(k)) signalIds.set(k, nextId++);
          return { id: signalIds.get(k)! };
        },
        getSeries: async (signalId: number, range?: { from?: string; to?: string }) => {
          const bars: { date: string; value: number }[] = [];
          for (const [k, v] of signalRows) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) !== signalId) continue;
            if (range?.from && d! < range.from) continue;
            if (range?.to && d! > range.to) continue;
            bars.push({ date: d!, value: v });
          }
          return bars.sort((a, b) => a.date.localeCompare(b.date));
        },
        writeSeries: async (signalId: number, bars: { date: string; value: number }[]) => {
          for (const b of bars) signalRows.set(`${signalId}::${b.date}`, b.value);
        },
        getLatestSeriesDate: async (signalId: number) => {
          let max: string | null = null;
          for (const k of signalRows.keys()) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) === signalId && (max === null || d! > max)) max = d!;
          }
          return max;
        },
        getLastValue: async (signalId: number) => {
          let max: string | null = null;
          for (const k of signalRows.keys()) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) === signalId && (max === null || d! > max)) max = d!;
          }
          return max ? (signalRows.get(`${signalId}::${max}`) ?? null) : null;
        },
      },
      allocations: {
        findOrCreate: async (holdings: Record<string, number>) => {
          const k = identityKey(holdings);
          if (!allocationIds.has(k)) allocationIds.set(k, nextId++);
          return { id: allocationIds.get(k)! };
        },
      },
      strategies: {
        create: async (_definition: Parameters<StorageProvider['strategies']['create']>[0]) => {
          const id = nextId++;
          return { id };
        },
        getSeries: async (strategyId: number, range?: { from?: string; to?: string }) => {
          const entries: StrategySeriesEntry[] = [];
          for (const [k, v] of strategyRows) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) !== strategyId) continue;
            if (range?.from && d! < range.from) continue;
            if (range?.to && d! > range.to) continue;
            entries.push({ date: d!, allocationId: v });
          }
          return entries.sort((a, b) => a.date.localeCompare(b.date));
        },
        writeSeries: async (strategyId: number, entries: StrategySeriesEntry[]) => {
          for (const e of entries) strategyRows.set(`${strategyId}::${e.date}`, e.allocationId);
        },
        getLatestSeriesDate: async (strategyId: number) => {
          let max: string | null = null;
          for (const k of strategyRows.keys()) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) === strategyId && (max === null || d! > max)) max = d!;
          }
          return max;
        },
        getLatestAllocationId: async (strategyId: number) => {
          let max: string | null = null;
          for (const k of strategyRows.keys()) {
            const [idStr, d] = k.split('::');
            if (Number(idStr) === strategyId && (max === null || d! > max)) max = d!;
          }
          return max ? (strategyRows.get(`${strategyId}::${max}`) ?? null) : null;
        },
        resolveReference: async () => {
          throw new Error('not supported in-memory');
        },
      },
      tradingDays: {
        getRange: async () => dates,
        getLatestClosed: async () => dates[dates.length - 1]!,
      },
    } as unknown as StorageProvider,
  };
}
