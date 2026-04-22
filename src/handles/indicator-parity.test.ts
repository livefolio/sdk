import { describe, it, expect, vi } from 'vitest';
import { IndicatorHandle } from './indicator';
import type { StorageProvider } from '../providers/storage';
import type { MarketProvider } from '../providers/market';

function makeInMemoryStorage(dates: string[]) {
  // Rows keyed by `${indicatorId}::${date}`
  const rows = new Map<string, { value: number; metadata: unknown }>();
  const indicatorIds = new Map<string, number>();
  let nextId = 1;

  function identityKey(identity: {
    type: string;
    tickerId: number | null;
    lookback: number;
    delay: number;
    unit: string | null;
    threshold: number | null;
  }) {
    return JSON.stringify(identity);
  }

  return {
    rows,
    storage: {
      tickers: {
        upsert: vi.fn().mockResolvedValue({ id: 1 }),
        findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
      },
      indicators: {
        upsert: vi.fn(),
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
      signals: {} as StorageProvider['signals'],
      allocations: { findOrCreate: vi.fn() },
      strategies: {} as StorageProvider['strategies'],
      tradingDays: {
        getRange: async () => dates,
        getLatestClosed: async () => dates[dates.length - 1]!,
      },
    } as unknown as StorageProvider,
  };
}

function syntheticPrices(dates: string[]): { date: string; value: number }[] {
  let x = 101;
  return dates.map((date, i) => {
    x = (x * 1664525 + 1013904223 + i) % 4294967296;
    return { date, value: 100 + (x % 10000) / 100 };
  });
}

describe('indicator cold→incremental parity', () => {
  const dates: string[] = [];
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= 25; d++) {
      dates.push(`2020-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }

  for (const { type, lookback } of [
    { type: 'SMA' as const, lookback: 20 },
    { type: 'EMA' as const, lookback: 20 },
    { type: 'RSI' as const, lookback: 14 },
    { type: 'Return' as const, lookback: 10 },
    { type: 'Volatility' as const, lookback: 20 },
    { type: 'Drawdown' as const, lookback: 20 },
  ]) {
    it(`${type}(${lookback}) is byte-identical between cold and incremental`, async () => {
      const { rows, storage } = makeInMemoryStorage(dates);
      const prices = syntheticPrices(dates);
      const market: MarketProvider = {
        fetchBars: vi.fn(async () => prices),
      } as unknown as MarketProvider;
      const ticker = {
        resolve: vi.fn().mockResolvedValue({ id: 1 }),
        symbol: 'SPY',
        leverage: 1,
      } as never;

      const h1 = new IndicatorHandle(storage, market, {
        type,
        ticker,
        lookback,
        delay: 0,
        unit: null,
        threshold: null,
      });
      await h1.series();
      const cold = await h1.series();

      // Delete last 3 rows of the stateful indicator's series.
      const { id: coldId } = await h1.resolve();
      for (let i = dates.length - 3; i < dates.length; i++) {
        rows.delete(`${coldId}::${dates[i]!}`);
      }

      const h2 = new IndicatorHandle(storage, market, {
        type,
        ticker,
        lookback,
        delay: 0,
        unit: null,
        threshold: null,
      });
      const incr = await h2.series();

      expect(incr.length).toBe(cold.length);
      for (let i = 0; i < cold.length; i++) {
        expect(incr[i]!.date).toBe(cold[i]!.date);
        expect(incr[i]!.value).toBeCloseTo(cold[i]!.value, 10);
      }
    });
  }
});
