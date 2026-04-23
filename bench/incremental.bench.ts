import { performance } from 'node:perf_hooks';
import { makeInMemoryStorage, syntheticPrices } from '../src/handles/__fixtures__/in-memory-storage';
import { StrategyHandle } from '../src/handles/strategy';
import { IndicatorHandle } from '../src/handles/indicator';
import { SignalHandle } from '../src/handles/signal';
import { AllocationHandle } from '../src/handles/allocation';
import { TickerHandle } from '../src/handles/ticker';
import type { MarketProvider } from '../src/providers/market';

async function main() {
  // 15k trading days
  const dates: string[] = [];
  const base = new Date('1970-01-02');
  for (let i = 0; i < 15000; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const { storage } = makeInMemoryStorage(dates);
  const prices = syntheticPrices(dates);
  const market: MarketProvider = { fetchBars: async () => prices } as unknown as MarketProvider;

  const spy = new TickerHandle(storage, 'SPY', 1);
  const qqq = new TickerHandle(storage, 'QQQ', 1);
  const cashx = new TickerHandle(storage, 'CASHX', 1);

  // 10 indicators: SMAs on SPY + QQQ of varied lookbacks
  const indicators: IndicatorHandle[] = [];
  for (const ticker of [spy, qqq]) {
    for (const lookback of [10, 20, 50, 100, 200]) {
      indicators.push(
        new IndicatorHandle(storage, market, {
          type: 'SMA',
          ticker,
          lookback,
          delay: 0,
          unit: null,
          threshold: null,
        }),
      );
    }
  }

  const price = new IndicatorHandle(storage, market, {
    type: 'Price',
    ticker: spy,
    lookback: 0,
    delay: 0,
    unit: null,
    threshold: null,
  });

  const sig = new SignalHandle(storage, market, {
    indicator1: price,
    indicator2: indicators[0]!,
    comparison: '>',
    tolerance: 0,
  });

  const alloc = new AllocationHandle(storage, [[spy, 1]]);
  const cash = new AllocationHandle(storage, [[cashx, 1]]);

  const strat = new StrategyHandle(storage, market, {
    name: 'bench',
    freq: 'Daily',
    offset: 0,
    rules: [{ when: [sig], hold: alloc }, { hold: cash }],
  });

  // Warm: cold sync + first preview (not timed)
  await strat.series();
  await strat.previewAllocation(dates[dates.length - 1]!, { SPY: 500, QQQ: 400 });

  const iterations = 100;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) {
    await strat.previewAllocation(dates[dates.length - 1]!, { SPY: 500 + i, QQQ: 400 + i });
  }
  const t1 = performance.now();
  console.log(`previewAllocation avg: ${((t1 - t0) / iterations).toFixed(2)} ms`);
}

void main();
