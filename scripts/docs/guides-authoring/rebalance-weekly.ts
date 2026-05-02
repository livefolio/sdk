// Rebalance schedules — weekly vs monthly comparison.
// Runs the same trend-following strategy at two cadences and counts how many
// rebalance events each produces. Shows that more frequent rebalancing means
// more trading opportunities but also more turnover.
//
//   npx tsx scripts/docs/guides-authoring/rebalance-weekly.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, RebalanceFrequency, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

// ─── Synthetic DataFeed ───────────────────────────────────────────────────────

const SPY = { id: 'us:SPY', symbol: 'SPY' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

function makeBars(start: Date, days: number, base: number, drift: number): Bar[] {
  const out: Bar[] = [];
  let price = base;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price *= 1 + drift + Math.sin(i / 12) * 0.005;
    out.push({ t, open: price, high: price * 1.004, low: price * 0.996, close: price, volume: 1_000_000 });
  }
  return out;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2021-01-04'), 1200, 370, 0.0004),
  'us:IEF': makeBars(utc('2021-01-04'), 1200, 115, 0.00003),
};

const dataFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// ─── Build a spec for a given frequency ──────────────────────────────────────

function buildSpec(frequency: RebalanceFrequency): TacticalSpec {
  return {
    kind: 'tactical/v1',
    universe: [SPY, IEF],
    // The only difference between the two runs is this field.
    rebalance: { frequency },
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
}

// ─── Run helper ───────────────────────────────────────────────────────────────

const range: DateRange = { from: utc('2021-06-01'), to: utc('2024-01-01') };

async function runFrequency(frequency: RebalanceFrequency): Promise<void> {
  const calendar = new NYSEExchangeCalendar();
  const featureCache = new MemoryFeatureCache();
  const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

  const executor = new BacktestExecutor({
    calendar,
    nextOpen: async (asset, t) => {
      const bars = FIXTURES[asset.id];
      if (!bars) throw new Error(`no fixture for ${asset.id}`);
      const next = bars.find((b) => b.t.getTime() > t.getTime());
      if (!next) throw new Error(`no bar after ${t.toISOString()}`);
      return { t: next.t, price: next.open };
    },
  });

  const spec = buildSpec(frequency);
  const strategy = fromSpec(spec, { runtime, calendar });

  const result = await runBacktest({
    strategy,
    range,
    initialPortfolio: { cash: 100_000, positions: [], t: range.from },
    dataFeed,
    executor,
    calendar,
  });

  const totalSessions = result.snapshots.length;
  const rebalanceSessions = result.snapshots.filter((s) => s.orders.length > 0).length;
  const orderCount = result.snapshots.reduce((sum, s) => sum + s.orders.length, 0);

  console.log(`\n[${frequency} rebalance]`);
  console.log(`  Total sessions    : ${totalSessions}`);
  console.log(`  Rebalance events  : ${rebalanceSessions}`);
  console.log(`  Total orders      : ${orderCount}`);
}

await runFrequency('Weekly');
await runFrequency('Monthly');

console.log('\nMonthly rebalancing produces fewer events and lower turnover.');
console.log('Weekly rebalancing reacts faster to trend changes.');
