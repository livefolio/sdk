// Custom Executor — guide sample
// Demonstrates a LoggingExecutor that wraps BacktestExecutor to print every
// order and fill, illustrating the decorator/wrapper pattern for Executor.
//
//   npx tsx scripts/docs/guides-runtime/custom-executor.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type {
  Executor,
  Order,
  Fill,
  Portfolio,
  DataFeed,
  Asset,
  Bar,
  DateRange,
  Frequency,
  TacticalSpec,
} from '@livefolio/sdk';

// ─── 1. Implement Executor ────────────────────────────────────────────────────
//
// Contract checklist:
//   - submit() returns one Fill per executed order (zero-qty orders omitted)
//   - submit() is idempotent per unique order.id — the same id must not double-fill
//   - fill.t must be >= t (the submission timestamp)
//   - submit() is async — broker calls or next-bar price lookups happen inside

/**
 * LoggingExecutor wraps any Executor to print every order and fill.
 * Useful for debugging and for audit trails in paper-trading setups.
 */
class LoggingExecutor implements Executor {
  constructor(private readonly inner: Executor) {}

  async submit(orders: ReadonlyArray<Order>, t: Date, portfolio: Portfolio): Promise<ReadonlyArray<Fill>> {
    console.log(`\n[executor] submit at ${t.toISOString()} — ${orders.length} order(s)`);

    for (const order of orders) {
      switch (order.kind) {
        case 'open':
          console.log(`  open   id=${order.id} asset=${order.asset.symbol} side=${order.side} qty=${order.quantity}`);
          break;
        case 'close':
          console.log(`  close  id=${order.id} positionId=${order.positionId} qty=${order.quantity ?? 'all'}`);
          break;
        case 'adjust':
          console.log(`  adjust id=${order.id} positionId=${order.positionId}`);
          break;
        case 'rebalance':
          console.log(`  rebal  id=${order.id} asset=${order.asset.symbol} delta=${order.delta}`);
          break;
      }
    }

    const fills = await this.inner.submit(orders, t, portfolio);

    for (const fill of fills) {
      console.log(
        `  fill   ref=${fill.orderRef} qty=${fill.quantity} price=${fill.price.toFixed(4)} fees=${fill.fees.toFixed(4)} t=${fill.t.toISOString()}`,
      );
    }

    return fills;
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
      price = price * (1 + drift + Math.sin(i / 10) * 0.005);
      bars.push({
        t: new Date(t),
        open: price,
        high: price * 1.005,
        low: price * 0.995,
        close: price,
        volume: 1_000_000,
      });
    }
    t = new Date(t.getTime() + MS_DAY);
  }
  return bars;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars('2024-01-02', 300, 480, 0.0004),
  'us:IEF': makeBars('2024-01-02', 300, 95, 0.0001),
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
  features: [{ id: 'spy_price', kind: 'price', asset: SPY }],
  rules: { op: 'allocate', weights: { 'us:SPY': 0.6, 'us:IEF': 0.4 } },
};

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: new Date('2024-02-01T00:00:00Z'), to: new Date('2024-06-01T00:00:00Z') };
const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

// Wrap the BacktestExecutor with LoggingExecutor.
const inner = new BacktestExecutor({
  calendar,
  nextOpen: async (asset, t) => {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    const next = bars.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`no bar after ${t.toISOString()} for ${asset.id}`);
    return { t: next.t, price: next.open };
  },
  slippageBps: 5,
  perShareFee: 0.005,
});

const executor = new LoggingExecutor(inner);
const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 50_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

console.log(`\nsessions   : ${result.snapshots.length}`);
console.log(`rebalances : ${result.snapshots.filter((s) => s.orders.length > 0).length}`);
