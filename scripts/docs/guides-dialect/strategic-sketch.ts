// strategic-sketch.ts — Worked example: strategic dialect.
// Implements a hypothetical 'strategic/v1' dialect: fixed weights, periodic
// rebalance, no feature computation, no rule tree.
// Runs a 60/40 SPY/IEF backtest with synthetic in-memory data.
//
// This is teaching code — strategic/v1 does NOT ship in @livefolio/sdk.
//
//   npx tsx scripts/docs/guides-dialect/strategic-sketch.ts

import {
  runBacktest,
  reconcile,
  isRebalanceDay,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
  FeatureRuntime,
} from '@livefolio/sdk';
import type {
  Asset,
  AssetId,
  AssetRef,
  Bar,
  Calendar,
  DataFeed,
  DateRange,
  Features,
  Frequency,
  Order,
  Portfolio,
  RebalanceFrequency,
  Strategy,
} from '@livefolio/sdk';

// ─── Spec type ────────────────────────────────────────────────────────────────

type StrategicSpec = {
  kind: 'strategic/v1';
  universe: AssetRef[];
  weights: Record<AssetId, number>;
  rebalance: { frequency: 'Monthly' | 'Quarterly' };
};

// ─── Features type ────────────────────────────────────────────────────────────

type StrategicFeatures = {
  prices: ReadonlyMap<AssetId, number>;
} & Features;

// ─── Validation ───────────────────────────────────────────────────────────────

function validateStrategicSpec(spec: StrategicSpec): void {
  const universeIds = new Set(spec.universe.map((a) => a.id));

  for (const id of Object.keys(spec.weights)) {
    if (!universeIds.has(id as AssetId)) {
      throw new Error(`strategic/v1: weight references asset "${id}" not declared in universe`);
    }
  }

  const total = Object.values(spec.weights).reduce((s, w) => s + w, 0);
  if (total > 1 + 1e-9) {
    throw new Error(`strategic/v1: weights sum to ${total.toFixed(4)}, must be ≤ 1.0`);
  }
}

// ─── Hydrator ─────────────────────────────────────────────────────────────────

type FromStrategicSpecOptions = {
  calendar: Calendar;
  dataFeed: DataFeed;
  freq: Frequency;
};

function fromStrategicSpec(spec: StrategicSpec, opts: FromStrategicSpecOptions): Strategy<StrategicFeatures> {
  validateStrategicSpec(spec);

  const universe: ReadonlyArray<Asset> = spec.universe.map((ref) => ({
    kind: 'equity' as const,
    id: ref.id,
    symbol: ref.symbol,
    ...(ref.exchange !== undefined ? { exchange: ref.exchange } : {}),
  }));

  const targets = new Map<AssetId, number>(Object.entries(spec.weights) as [AssetId, number][]);

  const cadence: RebalanceFrequency = spec.rebalance.frequency;

  return {
    universe(_t: Date, _portfolio: Portfolio): ReadonlyArray<Asset> {
      return universe;
    },

    async features(_universe: ReadonlyArray<Asset>, _portfolio: Portfolio, t: Date): Promise<StrategicFeatures> {
      // Fetch the most-recent closing price for each universe asset.
      // Strategic dialect needs prices for reconcile() on rebalance days.
      const lookback = new Date(t.getTime() - 7 * 86_400_000);
      const tomorrow = new Date(t.getTime() + 86_400_000);

      const priceEntries = await Promise.all(
        universe.map(async (asset): Promise<[AssetId, number | undefined]> => {
          let last: number | undefined;
          for await (const bar of opts.dataFeed.bars(asset, { from: lookback, to: tomorrow }, opts.freq)) {
            if (bar.t <= t) last = bar.close;
          }
          return [asset.id, last];
        }),
      );

      const prices = new Map<AssetId, number>();
      for (const [id, v] of priceEntries) {
        if (v !== undefined) prices.set(id, v);
      }
      return { prices };
    },

    build(features: StrategicFeatures, portfolio: Portfolio, t: Date): ReadonlyArray<Order> {
      // Gate: only rebalance on the last trading day of the period.
      if (!isRebalanceDay(t, cadence, opts.calendar)) return [];

      // Safety: skip if any target asset has no price data yet.
      for (const id of targets.keys()) {
        if (!features.prices.has(id)) return [];
      }

      // reconcile() computes the minimal set of orders to reach target weights.
      return reconcile(targets, portfolio, features.prices);
    },
  };
}

// ─── Synthetic DataFeed ───────────────────────────────────────────────────────

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(start: Date, days: number, base: number, drift: number): Bar[] {
  const out: Bar[] = [];
  let price = base;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue; // skip weekends
    price *= 1 + drift + Math.sin(i / 20) * 0.003;
    out.push({
      t,
      open: price * 0.999,
      high: price * 1.005,
      low: price * 0.995,
      close: price,
      volume: 5_000_000,
    });
  }
  return out;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-01-03'), 800, 460, 0.00035),
  'us:IEF': makeBars(utc('2022-01-03'), 800, 110, 0.00005),
};

const dataFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`strategic-sketch: no fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// ─── The spec: 60/40 SPY/IEF, monthly rebalance ───────────────────────────────

const spec: StrategicSpec = {
  kind: 'strategic/v1',
  universe: [
    { id: 'us:SPY', symbol: 'SPY' },
    { id: 'us:IEF', symbol: 'IEF' },
  ],
  weights: { 'us:SPY': 0.6, 'us:IEF': 0.4 },
  rebalance: { frequency: 'Monthly' },
};

// ─── Runtime wiring ───────────────────────────────────────────────────────────

const calendar = new NYSEExchangeCalendar();
const range: DateRange = { from: utc('2022-06-01'), to: utc('2024-01-01') };
const freq: Frequency = '1d';

// FeatureRuntime is needed by BacktestExecutor context but strategic dialect
// doesn't use it for indicators — it fetches prices directly from dataFeed.
const featureCache = new MemoryFeatureCache();
void featureCache; // unused in this sketch; kept to show the typical wiring

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset: Asset, t: Date) => {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`no bar after ${t.toISOString()} for ${asset.id}`);
    return { t: next.t, price: next.open };
  },
});

const strategy = fromStrategicSpec(spec, { calendar, dataFeed, freq });

// ─── Backtest ─────────────────────────────────────────────────────────────────

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

// ─── Output ───────────────────────────────────────────────────────────────────

const rebalanceSessions = result.snapshots.filter((s) => s.orders.length > 0);
const lastSnapshot = result.snapshots.at(-1);
const finalNAV =
  lastSnapshot !== undefined
    ? lastSnapshot.portfolio.cash +
      lastSnapshot.portfolio.positions.reduce((sum, p) => {
        const price = FIXTURES[p.asset.id]?.find((b) => b.t <= lastSnapshot.t)?.close ?? 0;
        return sum + p.quantity * price;
      }, 0)
    : 0;

console.log(`Strategic dialect (strategic/v1) — 60/40 SPY/IEF, monthly rebalance`);
console.log(`Range      : ${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)}`);
console.log(`Sessions   : ${result.snapshots.length}`);
console.log(`Rebalances : ${rebalanceSessions.length}`);
console.log(`Final cash : $${result.finalPortfolio.cash.toFixed(2)}`);
console.log(`Final NAV  : ~$${finalNAV.toFixed(2)}`);
console.log(`\nFirst rebalance orders:`);
if (rebalanceSessions[0] !== undefined) {
  for (const order of rebalanceSessions[0].orders) {
    if (order.kind === 'rebalance') {
      console.log(`  ${order.asset.symbol}: delta ${order.delta > 0 ? '+' : ''}${order.delta} shares`);
    }
  }
}

// FeatureRuntime is needed for the docs:check tsconfig — import it to prevent
// "declared but never read" if strict unused-locals is enabled.
void FeatureRuntime;
