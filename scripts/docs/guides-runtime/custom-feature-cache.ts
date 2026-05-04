// Custom FeatureCache — guide sample
// Demonstrates an InstrumentedCache that wraps MemoryFeatureCache to track
// hit/miss rate — a pattern you'd extend for Redis, filesystem, or TTL caches.
//
//   npx tsx scripts/docs/guides-runtime/custom-feature-cache.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type {
  FeatureCache,
  FeatureKey,
  Series,
  DataFeed,
  Asset,
  Bar,
  DateRange,
  Frequency,
  TacticalSpec,
} from '@livefolio/sdk';

// ─── 1. Implement FeatureCache ───────────────────────────────────────────────
//
// Contract:
//   get(key)           — return cached Series or undefined on miss
//   set(key, series)   — store a series; must be idempotent
//   invalidate(prefix) — optional; remove all entries whose key matches prefix
//
// Keys are content-addressed: the same feature + params + asset + date range
// + frequency always maps to the same key, regardless of which strategy
// triggered the computation. This means a shared cache (Redis, filesystem)
// lets multiple backtest processes reuse indicator results.

/**
 * InstrumentedCache wraps any FeatureCache to record hit/miss statistics.
 * Replace MemoryFeatureCache with a Redis client, SQLite store, or any other
 * FeatureCache implementation — the tracking logic stays unchanged.
 */
class InstrumentedCache implements FeatureCache {
  private hits = 0;
  private misses = 0;

  constructor(private readonly inner: FeatureCache) {}

  async get(key: FeatureKey): Promise<Series | undefined> {
    const result = await this.inner.get(key);
    if (result !== undefined) {
      this.hits++;
    } else {
      this.misses++;
    }
    return result;
  }

  async set(key: FeatureKey, series: Series): Promise<void> {
    return this.inner.set(key, series);
  }

  async invalidate(prefix: Partial<FeatureKey>): Promise<void> {
    return this.inner.invalidate?.(prefix);
  }

  /** Returns hit rate as a value in [0, 1]. Returns 0 if no requests yet. */
  hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  printStats(): void {
    const total = this.hits + this.misses;
    console.log(
      `FeatureCache stats — hits: ${this.hits}, misses: ${this.misses}, total: ${total}, hit-rate: ${(this.hitRate() * 100).toFixed(1)}%`,
    );
  }
}

// ─── 2. Synthetic DataFeed ────────────────────────────────────────────────────

const MS_DAY = 86_400_000;

function makeBars(startIso: string, count: number, base: number, drift: number): Bar[] {
  const bars: Bar[] = [];
  let price = base;
  let t = new Date(`${startIso}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const dow = t.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      price = price * (1 + drift + Math.sin(i / 8) * 0.006);
      bars.push({
        t: new Date(t),
        open: price,
        high: price * 1.004,
        low: price * 0.996,
        close: price,
        volume: 1_000_000,
      });
    }
    t = new Date(t.getTime() + MS_DAY);
  }
  return bars;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars('2023-01-02', 700, 390, 0.0005),
  'us:IEF': makeBars('2023-01-02', 700, 96, 0.0001),
};

const dataFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const all = FIXTURES[asset.id];
    if (!all) throw new Error(`no fixture for ${asset.id}`);
    for (const b of all) {
      if (b.t >= range.from && b.t < range.to) yield b;
    }
  },
};

// ─── 3. Wire into a backtest ──────────────────────────────────────────────────

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY, IEF],
  rebalance: { frequency: 'Monthly' },
  features: [
    { id: 'spy_price', kind: 'price', asset: SPY },
    { id: 'spy_sma20', kind: 'sma', asset: SPY, period: 20 },
    { id: 'spy_rsi14', kind: 'rsi', asset: SPY, period: 14 },
  ],
  rules: {
    op: 'if',
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma20' } },
    then: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
    else: { op: 'allocate', weights: { 'us:IEF': 1.0 } },
  },
};

const calendar = new NYSEExchangeCalendar();
const cache = new InstrumentedCache(new MemoryFeatureCache());
const range: DateRange = { from: new Date('2023-04-01T00:00:00Z'), to: new Date('2024-06-01T00:00:00Z') };
const runtime = new FeatureRuntime({ dataFeed, featureCache: cache, range, freq: '1d' });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset, t) => {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`no bar after ${t.toISOString()} for ${asset.id}`);
    return { t: next.t, price: next.open };
  },
});

const strategy = fromSpec(spec, { runtime, calendar });

await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

// Print cache statistics after the backtest completes.
cache.printStats();
