// Custom DataFeed — guide sample
// Demonstrates a MockDataFeed that returns deterministic synthetic bars,
// then drives a real runBacktest call with it.
//
//   npx tsx scripts/docs/guides-runtime/custom-datafeed.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { DataFeed, Asset, Bar, DateRange, Frequency, TacticalSpec } from '@livefolio/sdk';

// ─── 1. Implement DataFeed ────────────────────────────────────────────────────
//
// Contract checklist:
//   - bars() is an async generator — AsyncIterable<Bar>
//   - Bars MUST be yielded in ascending `t` order
//   - Only yield bars whose `t` satisfies: range.from <= t < range.to
//   - Omit non-trading periods (gaps are normal and expected)
//   - fundamentals / events are optional; omit them when not supported

const MS_DAY = 86_400_000;

/** Generate deterministic synthetic daily bars for a single asset. */
function generateBars(startIso: string, count: number, seed: number): Bar[] {
  const bars: Bar[] = [];
  let price = seed;
  let t = new Date(`${startIso}T00:00:00Z`);

  for (let i = 0; i < count; i++) {
    // Skip weekends — a real feed would skip exchange holidays too.
    const dow = t.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      price = price * (1 + Math.sin(i / 12) * 0.008 + 0.0003);
      bars.push({
        t: new Date(t),
        open: price * 0.999,
        high: price * 1.006,
        low: price * 0.994,
        close: price,
        volume: 1_000_000 + i * 1_000,
      });
    }
    t = new Date(t.getTime() + MS_DAY);
  }
  return bars;
}

const FIXTURE_BARS: Record<string, Bar[]> = {
  'us:SPY': generateBars('2023-01-02', 600, 380),
  'us:IEF': generateBars('2023-01-02', 600, 95),
};

/**
 * MockDataFeed — fulfils the DataFeed contract using pre-built in-memory bars.
 *
 * Real adapters follow the same shape. The only difference is that `bars()`
 * would issue an HTTP request (or read a file) rather than filtering a local
 * array. The half-open range filter and ascending-order guarantee are
 * identical in both cases.
 */
class MockDataFeed implements DataFeed {
  bars(asset: Asset, range: DateRange, _freq: Frequency): AsyncIterable<Bar> {
    return this.iterate(asset, range);
  }

  private async *iterate(asset: Asset, range: DateRange): AsyncIterable<Bar> {
    const all = FIXTURE_BARS[asset.id];
    if (all === undefined) {
      throw new Error(`MockDataFeed: no fixture for asset "${asset.id}"`);
    }

    const fromMs = range.from.getTime();
    const toMs = range.to.getTime();

    for (const bar of all) {
      const tMs = bar.t.getTime();
      // Half-open interval: [range.from, range.to)
      if (tMs >= fromMs && tMs < toMs) {
        yield bar;
      }
    }
  }
}

// ─── 2. Wire into a backtest ──────────────────────────────────────────────────

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, IEF],
  rebalance: { frequency: 'Monthly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma50', kind: 'sma', asset: SPY, period: 50 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma50' } },
    then: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};

const dataFeed = new MockDataFeed();
const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: new Date('2023-03-01T00:00:00Z'), to: new Date('2024-06-01T00:00:00Z') };
const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset, t) => {
    const bars = FIXTURE_BARS[asset.id];
    if (bars === undefined) throw new Error(`no fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`no bar after ${t.toISOString()} for ${asset.id}`);
    return { t: next.t, price: next.open };
  },
});

const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

const final = result.snapshots.at(-1);
console.log(`sessions    : ${result.snapshots.length}`);
console.log(`rebalances  : ${result.snapshots.filter((s) => s.orders.length > 0).length}`);
console.log(`final cash  : $${final?.portfolio.cash.toFixed(2)}`);
for (const p of final?.portfolio.positions ?? []) {
  console.log(`  ${p.asset.symbol} qty=${p.quantity} basis=$${p.basis.toFixed(2)}`);
}
