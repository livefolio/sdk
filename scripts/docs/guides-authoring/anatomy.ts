// Anatomy of a TacticalSpec — annotated complete example.
// Demonstrates every top-level field with comments explaining each choice.
// Self-contained: the DataFeed is synthetic so no external service is needed.
//
//   npx tsx scripts/docs/guides-authoring/anatomy.ts

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

// ─── Asset references ────────────────────────────────────────────────────────
// AssetRef binds a human-readable symbol to a stable, exchange-scoped id.
// The id is what appears in allocate weight maps; the symbol is for display.
const SPY = { id: 'us:SPY', symbol: 'SPY' };
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const IEF = { id: 'us:IEF', symbol: 'IEF' };

// ─── The spec ────────────────────────────────────────────────────────────────
const spec: TacticalSpec = {
  // kind — dialect identifier. Always 'tactical/v1' for current strategies.
  // 'tactical/v0' is accepted but emits a deprecation warning.
  kind: 'tactical/v1',

  // universe — the tradeable assets. Every asset referenced in `rules` weights
  // must appear here. Order does not matter for execution.
  universe: [SPY, QQQ, IEF],

  // rebalance — how often the rule tree runs. Omit for daily rebalancing.
  // Valid frequencies: 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly'
  rebalance: { frequency: 'Weekly' },

  // features — named indicators. Each entry gets an `id` that `rules` can
  // reference via { ref: 'id' }. Supported kinds:
  //   'price'      — raw close price
  //   'sma'        — simple moving average (requires `period`)
  //   'ema'        — exponential moving average (requires `period`)
  //   'rsi'        — relative strength index (requires `period`)
  //   'return'     — rolling return (requires `period`, optional `mode`)
  //   'volatility' — rolling annualised volatility (requires `period`)
  //   'drawdown'   — rolling max drawdown (requires `period`)
  features: [
    // Current close price of SPY
    { id: 'spy_price', kind: 'price', asset: SPY },
    // 200-day SMA — the classic trend filter
    { id: 'spy_sma200', kind: 'sma', asset: SPY, period: 200 },
    // 14-day RSI for a secondary momentum check
    { id: 'spy_rsi14', kind: 'rsi', asset: SPY, period: 14 },
  ],

  // rules — a binary decision tree of IfNode / AllocateNode nodes.
  // The tree is evaluated top-down; the first matching AllocateNode wins.
  // Weights are fractions of NAV (must sum to ≤ 1.0; remainder stays in cash).
  rules: {
    op: 'if',
    // Primary trend condition: SPY price above its 200-day SMA
    cond: { op: 'gt', left: { ref: 'spy_price' }, right: { ref: 'spy_sma200' } },
    then: {
      op: 'if',
      // Secondary filter: not deeply overbought (RSI < 80)
      cond: { op: 'lt', left: { ref: 'spy_rsi14' }, right: 80 },
      then: {
        // Risk-on: growth tilt
        op: 'allocate',
        weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 },
      },
      else: {
        // Overbought even in uptrend — trim risk slightly
        op: 'allocate',
        weights: { 'us:SPY': 0.5, 'us:QQQ': 0.2, 'us:IEF': 0.3 },
      },
    },
    else: {
      // Downtrend: move to bonds
      op: 'allocate',
      weights: { 'us:IEF': 1.0 },
    },
  },
};

// ─── Synthetic DataFeed ───────────────────────────────────────────────────────

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

function makeBars(start: Date, days: number, base: number, drift: number): Bar[] {
  const out: Bar[] = [];
  let price = base;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price *= 1 + drift + Math.sin(i / 10) * 0.004;
    out.push({ t, open: price, high: price * 1.004, low: price * 0.996, close: price, volume: 1_000_000 });
  }
  return out;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-01-03'), 800, 460, 0.0004),
  'us:QQQ': makeBars(utc('2022-01-03'), 800, 380, 0.0005),
  'us:IEF': makeBars(utc('2022-01-03'), 800, 110, 0.00003),
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

// ─── Runtime wiring & backtest ────────────────────────────────────────────────

const calendar = new NYSEExchangeCalendar();
const range: DateRange = { from: utc('2022-06-01'), to: utc('2024-01-01') };
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

const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

const rebalances = result.snapshots.filter((s) => s.orders.length > 0).length;
console.log(`Sessions  : ${result.snapshots.length}`);
console.log(`Rebalances: ${rebalances}`);
console.log(`Final NAV : $${result.snapshots.at(-1)?.portfolio.cash.toFixed(2)} cash`);
