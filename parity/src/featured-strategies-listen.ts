// Live listener: WebSocket-driven runLive against Yahoo's tick stream.
//
// Architecture (matches the design `runLive` was built for):
//
//   wss://streamer.finance.yahoo.com → YfinanceStreamingDataFeed
//                                      yields one StreamingBar per trade
//                                      ↓
//   runLive
//     • recordTick — wiggles the in-flight bar (open=first, high=max, low=min, close=last)
//     • emits `mark` event on every tick (intra-session mark-to-market)
//     • on session-close boundary: finalizeBars → runtime.appendBar
//                                  strategy.build → emits `snapshot`
//                                  starts a fresh wiggling bar for the next session
//
// The previous version of this script used `pollingStreamFromHistorical`,
// which yields one canonical daily bar per session — runLive saw a single
// "tick" per day with nothing to wiggle, so during market hours it looked
// silent. The actual fix wasn't to bypass runLive; it was to swap in the
// WebSocket feed `runLive` was always meant to consume.
//
// Defaults:
//   STRATEGY=trend-rocket     (also: golden-butterfly, crisis-ready, leveraged-ma)
//   MAX_MINUTES=10            wall-clock cap
//   MAX_TICKS=0               extra cap on tick count (0 disables)
//
//   STRATEGY=trend-rocket MAX_MINUTES=10 \
//     npx tsx parity/src/featured-strategies-listen.ts

import {
  fromSpec,
  runBacktest,
  runLive,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, AssetId, Bar, DateRange } from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';
import { YfinanceStreamingDataFeed } from '@livefolio/yfinance-browser';

// --- 1. Featured strategy specs -------------------------------------------

const TQQQ = { id: 'us:TQQQ', symbol: 'TQQQ' };
const SQQQ = { id: 'us:SQQQ', symbol: 'SQQQ' };
const QQQ = { id: 'us:QQQ', symbol: 'QQQ' };
const SPY = { id: 'us:SPY', symbol: 'SPY' };
const UPRO = { id: 'us:UPRO', symbol: 'UPRO' };
const UGL = { id: 'us:UGL', symbol: 'UGL' };
const GLD = { id: 'us:GLD', symbol: 'GLD' };
const IAU = { id: 'us:IAU', symbol: 'IAU' };
const AGG = { id: 'us:AGG', symbol: 'AGG' };
const KMLM = { id: 'us:KMLM', symbol: 'KMLM' };
const ZROZ = { id: 'us:ZROZ', symbol: 'ZROZ' };
const UUP = { id: 'us:UUP', symbol: 'UUP' };
const USMV = { id: 'us:USMV', symbol: 'USMV' };
const VTIP = { id: 'us:VTIP', symbol: 'VTIP' };
const LCSIX = { id: 'us:LCSIX', symbol: 'LCSIX' };

const SPECS: Record<string, TacticalSpec> = {
  'trend-rocket': {
    kind: 'tactical/v1',
    universe: [UGL, TQQQ, UPRO, AGG, GLD, SPY],
    rebalance: { frequency: 'Daily' },
    features: [
      { id: 'spy_sma5', kind: 'sma', asset: SPY, period: 5, delay: 1 },
      { id: 'spy_sma200', kind: 'sma', asset: SPY, period: 200, delay: 1 },
    ],
    rules: {
      op: 'if',
      cond: { op: 'gt', left: { ref: 'spy_sma5' }, right: { ref: 'spy_sma200' } },
      then: { op: 'allocate', weights: { 'us:UGL': 0.3334, 'us:TQQQ': 0.3333, 'us:UPRO': 0.3333 } },
      else: { op: 'allocate', weights: { 'us:AGG': 0.3334, 'us:GLD': 0.3333, 'us:SPY': 0.3333 } },
    },
  },
  'golden-butterfly': {
    kind: 'tactical/v1',
    universe: [TQQQ, SQQQ, IAU, UUP, USMV, LCSIX, VTIP],
    rebalance: { frequency: 'Daily' },
    features: [
      { id: 'tqqq_rsi14', kind: 'rsi', asset: TQQQ, period: 14 },
      { id: 'tqqq_price', kind: 'price', asset: TQQQ },
      { id: 'tqqq_sma200', kind: 'sma', asset: TQQQ, period: 200 },
    ],
    rules: {
      op: 'if',
      cond: { op: 'lt', left: { ref: 'tqqq_rsi14' }, right: 30 },
      then: { op: 'allocate', weights: { 'us:TQQQ': 1.0 } },
      else: {
        op: 'if',
        cond: { op: 'gt', left: { ref: 'tqqq_rsi14' }, right: 80 },
        then: { op: 'allocate', weights: { 'us:SQQQ': 1.0 } },
        else: {
          op: 'if',
          cond: { op: 'gt', left: { ref: 'tqqq_price' }, right: { ref: 'tqqq_sma200' } },
          then: {
            op: 'allocate',
            weights: { 'us:IAU': 0.2, 'us:UUP': 0.2, 'us:TQQQ': 0.2, 'us:USMV': 0.2, 'us:LCSIX': 0.2 },
          },
          else: {
            op: 'allocate',
            weights: { 'us:IAU': 0.2, 'us:UUP': 0.2, 'us:USMV': 0.2, 'us:VTIP': 0.2, 'us:LCSIX': 0.2 },
          },
        },
      },
    },
  },
  'crisis-ready': {
    kind: 'tactical/v1',
    universe: [UGL, KMLM, UPRO],
    rebalance: { frequency: 'Daily' },
    features: [],
    rules: { op: 'allocate', weights: { 'us:UGL': 0.33, 'us:KMLM': 0.33, 'us:UPRO': 0.34 } },
  },
  'leveraged-ma': {
    kind: 'tactical/v1',
    universe: [UGL, KMLM, ZROZ, TQQQ, QQQ],
    rebalance: { frequency: 'Monthly' },
    features: [
      { id: 'qqq_price', kind: 'price', asset: QQQ },
      { id: 'qqq_sma200', kind: 'sma', asset: QQQ, period: 200 },
    ],
    rules: {
      op: 'if',
      cond: { op: 'lt', left: { ref: 'qqq_price' }, right: { ref: 'qqq_sma200' } },
      then: { op: 'allocate', weights: { 'us:UGL': 0.3334, 'us:KMLM': 0.3333, 'us:ZROZ': 0.3333 } },
      else: { op: 'allocate', weights: { 'us:TQQQ': 0.6, 'us:UGL': 0.15, 'us:KMLM': 0.15, 'us:ZROZ': 0.1 } },
    },
  },
};

const STRATEGY_KEY = process.env.STRATEGY ?? 'trend-rocket';
const MAX_MINUTES = Number(process.env.MAX_MINUTES ?? '10');
const MAX_TICKS = Number(process.env.MAX_TICKS ?? '0');

const specOrUndef = SPECS[STRATEGY_KEY];
if (!specOrUndef) {
  console.error(`unknown STRATEGY=${STRATEGY_KEY}; valid: ${Object.keys(SPECS).join(', ')}`);
  process.exit(1);
}
const spec: TacticalSpec = specOrUndef;

const calendar = new NYSEExchangeCalendar();
const featureCache = new MemoryFeatureCache();

// --- 2. Backtest seed (historical leg via REST yfinance) ------------------

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
// Stop the seed a few sessions before today so the executor's nextOpen lookup
// always finds a fill bar — mutual funds and some ETFs can lag a session on
// yfinance, especially right after market open.
const seedTo = new Date(today.getTime() - 5 * 86_400_000);
const range: DateRange = { from: new Date(seedTo.getTime() - 365 * 86_400_000), to: seedTo };
const runtimeRange: DateRange = {
  from: new Date(today.getTime() - 3 * 365 * 86_400_000),
  to: new Date(today.getTime() + 86_400_000),
};

const histFeed = new YfinanceDataFeed();

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset: Asset, t: Date) => {
    for await (const bar of histFeed.bars(asset, runtimeRange, '1d')) {
      if (bar.t.getTime() > t.getTime()) return { t: bar.t, price: bar.open };
    }
    throw new Error(`featured-strategies-listen: no next-open for ${asset.symbol} after ${t.toISOString()}`);
  },
});

console.log(`=== featured-strategies live listener (${STRATEGY_KEY}) ===`);
console.log(`upstream       : YfinanceStreamingDataFeed (wss://streamer.finance.yahoo.com)`);
console.log(`max wall-clock : ${MAX_MINUTES}min`);
if (MAX_TICKS > 0) console.log(`max ticks      : ${MAX_TICKS}`);
console.log(`seed range     : ${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)}`);
console.log('');
console.log('Seeding from historical backtest …');

const histRuntime = new FeatureRuntime({ dataFeed: histFeed, featureCache, range: runtimeRange, freq: '1d' });
const histStrategy = fromSpec(spec, { runtime: histRuntime, calendar });

const history = await runBacktest({
  strategy: histStrategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed: histFeed,
  executor,
  calendar,
  featureCache,
  featureRuntime: histRuntime,
});

const lastSnap = history.snapshots.at(-1);
if (lastSnap) {
  const positions = lastSnap.portfolio.positions
    .filter((p) => p.quantity !== 0)
    .map((p) => `${p.asset.symbol}×${p.quantity.toFixed(0)}`)
    .join(' ');
  console.log(`seed sessions     : ${history.snapshots.length}`);
  console.log(`last seed session : ${lastSnap.t.toISOString().slice(0, 10)}`);
  console.log(`last positions    : ${positions || '(none)'}`);
}
console.log('');

// --- 3. Live WebSocket feed -----------------------------------------------
//
// Use history.bars as-is. The seed backtest's `featureRuntime` fetched bars
// over the full runtimeRange (which extends past the backtest range up to
// `today + 1d`), so history.bars contains every finalized session bar
// available on yfinance, including the days between `seedTo` and today
// (e.g. last Thursday/Friday for a Monday run). Earlier we filtered these
// off, which had the side effect of pinning indicator features to the
// SMA values computed at `seedTo` — meaning live evaluation with `delay: 1`
// returned values from a week ago instead of yesterday. Keeping all bars
// makes the runtime current as of the last finalized session, which is what
// you'd expect from "continuing the historical result into a live session."
const seedBars = new Map<string, Bar[]>();
for (const [assetId, bars] of history.bars) seedBars.set(assetId, [...bars]);

const liveFeed = new YfinanceStreamingDataFeed({
  onStatus: (s) => console.log(`[${stamp()}] ws status: ${s}`),
  onError: (e) => console.error(`[${stamp()}] ws error : ${e.message}`),
});

const streamingRuntime = new FeatureRuntime({
  mode: 'streaming',
  featureCache: new MemoryFeatureCache(),
  freq: '1d',
  initialBars: seedBars,
});
const liveStrategy = fromSpec(spec, { runtime: streamingRuntime, calendar });

// `runLive` now commits the in-flight wiggle bar into `streamingRuntime` on
// every tick (FeatureRuntime.appendBar accepts same-t replacement), so
// `mark.features` already reflects the running close. No shadow runtime
// needed.

// --- 4. Wall-clock cap ----------------------------------------------------

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

const maxMs = MAX_MINUTES * 60 * 1000;
const startMs = Date.now();
const timeoutHandle = setTimeout(() => {
  console.log('');
  console.log(`[${stamp()}] wall-clock cap reached after ${MAX_MINUTES}min — exiting`);
  process.exit(0);
}, maxMs);

console.log(`Listening for live ticks (max ${MAX_MINUTES}min)…`);
console.log('--- live events ---');

let tickCount = 0;
let markCount = 0;
let snapshotCount = 0;
const lastClose = new Map<AssetId, number>();

// Compact stringifier for tactical/v1's feature shape, which fromSpec returns
// as { values: Map<string, number|undefined>, prices: Map<AssetId, number> }.
// Falls back to enumerating own number-valued props if some other strategy
// type is in use.
function fmtFeatures(features: unknown): string {
  if (features === null || typeof features !== 'object') return '';
  const f = features as { values?: unknown };
  if (f.values instanceof Map) {
    const entries: string[] = [];
    for (const [k, v] of f.values as Map<string, number | undefined>) {
      if (typeof v === 'number') entries.push(`${k}=${v.toFixed(2)}`);
    }
    return entries.join(' ');
  }
  const entries: string[] = [];
  for (const [k, v] of Object.entries(features as Record<string, unknown>)) {
    if (typeof v === 'number') entries.push(`${k}=${v.toFixed(2)}`);
  }
  return entries.join(' ');
}

// Identify the preview branch from the order set. Preview can be empty when
// the current portfolio already matches the target weights (no rebalance
// needed) — in that case we infer from the current held positions instead.
function fmtPreviewBranch(orders: ReadonlyArray<{ kind: string; asset?: { symbol: string } }>): string {
  if (orders.length === 0) return '(no rebalance)';
  const buys = orders
    .filter((o) => 'asset' in o && o.asset)
    .map((o) => o.asset!.symbol)
    .sort();
  const uniq = [...new Set(buys)];
  return `would_buy=[${uniq.join(',')}]`;
}

try {
  for await (const ev of runLive({
    strategy: liveStrategy,
    history,
    dataFeed: liveFeed,
    executor,
    calendar,
    streamingRuntime,
  })) {
    if (ev.type === 'mark') {
      tickCount++;
      markCount++;
      // The mark event's prices map carries the in-flight bar's running close
      // for every asset that has ticked this session. Print only the asset(s)
      // whose close changed since the previous mark — keeps the log readable.
      const changed: string[] = [];
      for (const [id, price] of ev.prices) {
        const prev = lastClose.get(id);
        if (prev === undefined || prev !== price) {
          const sym = id.replace(/^us:/, '');
          const delta =
            prev === undefined ? '       —' : `${price - prev >= 0 ? '+' : ''}${(price - prev).toFixed(4)}`.padStart(9);
          changed.push(`${sym} $${price.toFixed(2)} Δ=${delta}`);
          lastClose.set(id, price);
        }
      }
      if (changed.length > 0) {
        // runLive's mark events now reflect the running close — features
        // recompute over the wiggled in-flight bar on every tick.
        const featuresLine = fmtFeatures(ev.features);
        const previewLine = fmtPreviewBranch(ev.previewOrders);
        const featuresPart = featuresLine ? `  features=[${featuresLine}]` : '';
        console.log(
          `[${stamp()}] tick #${tickCount}  ${changed.join('  ')}  preview=${ev.previewOrders.length} ${previewLine}${featuresPart}`,
        );
      }
    } else {
      snapshotCount++;
      const positions = ev.portfolio.positions
        .filter((p) => p.quantity !== 0)
        .map((p) => `${p.asset.symbol}×${p.quantity.toFixed(0)}`)
        .join(' ');
      console.log(
        `[${stamp()}] SNAPSHOT  session=${ev.t.toISOString().slice(0, 10)}  cash=$${ev.portfolio.cash.toFixed(2)}  positions=[${positions}]  orders=${ev.orders.length}`,
      );
    }
    if (Date.now() - startMs >= maxMs) break;
    if (MAX_TICKS > 0 && tickCount >= MAX_TICKS) break;
  }
} finally {
  clearTimeout(timeoutHandle);
}

console.log('');
console.log(`done. ticks=${tickCount}  marks=${markCount}  snapshots=${snapshotCount}`);
