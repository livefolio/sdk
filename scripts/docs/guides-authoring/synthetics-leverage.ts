// Synthetics — 2x leveraged SPY comparison backtest.
// Defines a SyntheticAsset that models SSO (ProShares Ultra S&P 500, 2x SPY)
// without needing the real ETF's price history. Runs two strategies side-by-side
// (unlevered vs levered) and prints final NAVs to show the compounding effect.
//
//   npx tsx scripts/docs/guides-authoring/synthetics-leverage.ts

import {
  fromSpec,
  runBacktest,
  withSynthetics,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, SyntheticAsset, Asset, Bar, DataFeed, DateRange, Frequency } from '@livefolio/sdk';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

// ─── Asset references ─────────────────────────────────────────────────────────

const SPY_REF = { id: 'us:SPY', symbol: 'SPY' };
// SSO is our synthetic — same exchange prefix, distinct id and symbol
const SSO_REF = { id: 'us:SSO', symbol: 'SSO' };

// ─── SyntheticAsset definition ────────────────────────────────────────────────
// leverage: 2  → each 1 % SPY move becomes a ~2 % SSO move (daily reset)
// expense: 0.91 → 0.91 % annual fee (matching SSO's real expense ratio),
//                 deducted as (0.91 / 252) per trading day
const SSO: SyntheticAsset = {
  id: 'us:SSO',
  symbol: 'SSO',
  underlying: SPY_REF,
  leverage: 2,
  expense: 0.91,
};

// ─── In-memory DataFeed ───────────────────────────────────────────────────────

function makeBars(start: Date, days: number, base: number, drift: number): Bar[] {
  const out: Bar[] = [];
  let price = base;
  for (let i = 0; i < days; i++) {
    const t = new Date(start.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 0 || t.getUTCDay() === 6) continue;
    price *= 1 + drift + Math.sin(i / 15) * 0.003;
    out.push({ t, open: price, high: price * 1.004, low: price * 0.996, close: price, volume: 1_000_000 });
  }
  return out;
}

const FIXTURES: Record<string, Bar[]> = {
  'us:SPY': makeBars(utc('2022-01-03'), 800, 460, 0.0005),
};

// The raw DataFeed only knows about SPY.
// withSynthetics wraps it to intercept requests for SSO and synthesize bars.
const rawFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    const bars = FIXTURES[asset.id];
    if (!bars) throw new Error(`no fixture for ${asset.id}`);
    for (const bar of bars) {
      if (bar.t >= range.from && bar.t < range.to) yield bar;
    }
  },
};

// withSynthetics returns a new DataFeed that transparently serves SSO bars.
const dataFeed = withSynthetics(rawFeed, [SSO]);

// ─── Strategy specs ───────────────────────────────────────────────────────────

// Unlevered: 100 % SPY (always-invested benchmark)
const specUnlevered: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SPY_REF],
  rebalance: { frequency: 'Monthly' },
  features: [],
  rules: { op: 'allocate', weights: { 'us:SPY': 1.0 } },
};

// Levered: 100 % SSO (synthetic 2x SPY)
// Note: SSO must appear in the universe and in synthetics on the spec.
const specLevered: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [SSO_REF],
  synthetics: [SSO],
  rebalance: { frequency: 'Monthly' },
  features: [],
  rules: { op: 'allocate', weights: { 'us:SSO': 1.0 } },
};

// ─── Run helper ───────────────────────────────────────────────────────────────

const calendar = new NYSEExchangeCalendar();
const range: DateRange = { from: utc('2022-06-01'), to: utc('2024-01-01') };

async function runSpec(spec: TacticalSpec): Promise<number> {
  const featureCache = new MemoryFeatureCache();
  const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

  const executor = new BacktestExecutor({
    calendar,
    nextOpen: async (asset, t) => {
      // SSO bars are served by the synthetic DataFeed
      const assetBars: Bar[] = [];
      for await (const bar of dataFeed.bars(asset, { from: t, to: range.to }, '1d')) {
        if (bar.t.getTime() > t.getTime()) {
          assetBars.push(bar);
          break;
        }
      }
      const next = assetBars[0];
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

  const last = result.snapshots.at(-1);
  if (!last) return 0;

  // NAV = cash + sum(qty * price). Prices approximate via position basis.
  let nav = last.portfolio.cash;
  for (const pos of last.portfolio.positions) {
    nav += pos.quantity * pos.basis;
  }
  return nav;
}

const navUnlevered = await runSpec(specUnlevered);
const navLevered = await runSpec(specLevered);

console.log(`Unlevered SPY  final NAV : $${navUnlevered.toFixed(2)}`);
console.log(`Levered 2x SSO final NAV : $${navLevered.toFixed(2)}`);
console.log(`Leverage ratio (approx)  : ${(navLevered / navUnlevered).toFixed(2)}x`);
console.log('\nNote: daily-reset compounding and expense drag mean the levered');
console.log('ratio diverges from exactly 2x over longer holding periods.');
