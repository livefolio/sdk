import { describe, it, expect, vi } from 'vitest';
import { IndicatorHandle } from './indicator';
import type { MarketProvider } from '../providers/market';
import { makeInMemoryStorage, syntheticPrices } from './__fixtures__/in-memory-storage';

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
