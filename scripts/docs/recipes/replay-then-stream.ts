// Recipe: Replay-then-stream — continuous chart from history -> live
//
// Demonstrates the canonical Phase 9 workflow: render historical performance
// from runBacktest, then continue updating the same chart with live snapshots
// and per-tick previews from runLive.
//
// Key concepts:
//   - Strategy<F, S> with threaded state (S = { tickCount: number })
//   - BacktestResult.finalState + bars seed the live runtime
//   - runLive emits LiveEvent<mark | snapshot>: demux for chart updates
//   - Calendar drives session boundaries; adapter emits raw ticks
//   - Preview-build via structuredClone (state never corrupted by mark previews)
//
//   npx tsx scripts/docs/recipes/replay-then-stream.ts
//
// Companion docs: docs-site/recipes/replay-then-stream.md
// Companion spec: docs/specs/2026-05-02-v0.4-phase-9-streaming-design.md

import {
  runBacktest,
  runLive,
  FeatureRuntime,
  MemoryFeatureCache,
  BacktestExecutor,
  Crypto24x7Calendar,
} from '@livefolio/sdk';
import type {
  Asset,
  Bar,
  DataFeed,
  StreamingBar,
  StreamingDataFeed,
  Strategy,
  Features,
  Order,
  BacktestSnapshot,
} from '@livefolio/sdk';

// --- 1. Universe & fixture data ------------------------------------------

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };

// 21 days of synthetic SPY bars at 00:00 UTC, ascending close $100 -> $120.
// First 14 days are the "historical" run; days 15-21 stream in live.
const allBars: Bar[] = Array.from({ length: 21 }, (_, i) => ({
  t: new Date(Date.UTC(2024, 5, i + 1)),
  open: 100 + i,
  high: 100 + i,
  low: 100 + i,
  close: 100 + i,
  volume: 0,
}));

const HISTORICAL_BARS = allBars.slice(0, 14);
const LIVE_BARS = allBars.slice(14);

function feedFor(bars: Bar[]): DataFeed {
  return {
    async *bars(_asset, range, _freq) {
      for (const b of bars) {
        if (b.t >= range.from && b.t < range.to) yield b;
      }
    },
  };
}

// --- 2. State-threaded strategy ------------------------------------------
//
// Counts the sessions it has seen and emits a rebalance order every 5 sessions.
// In a 21-session run, this fires on sessions 5, 10, 15, 20 — the first two
// land during replay, the last two during live mode. The state-handoff is
// what makes this work: replayResult.finalState carries tickCount=14 into
// runLive, so the next rebalance correctly fires at tickCount=15 (not 5 again).

type S = { tickCount: number };

function makeStrategy(): Strategy<Features, S> {
  return {
    universe: () => [SPY],
    features: async () => ({}),
    initialState: () => ({ tickCount: 0 }),
    build: (_features, _portfolio, state, _t) => {
      const next = state.tickCount + 1;
      const orders: Order[] = [];
      if (next % 5 === 0) {
        orders.push({
          kind: 'rebalance',
          id: `buy-${next}`,
          asset: SPY,
          delta: 1,
        });
      }
      return { orders, state: { tickCount: next } };
    },
  };
}

// --- 3. Runtime layers ----------------------------------------------------

const calendar = new Crypto24x7Calendar();

// Backtest executor needs a nextOpen lookup. We use the same-day close as
// fill price for simplicity (deterministic across replay + live).
const allBarsByT = new Map<number, Bar>(allBars.map((b) => [b.t.getTime(), b]));
function makeExecutor(): BacktestExecutor {
  return new BacktestExecutor({
    calendar,
    nextOpen: async (_asset: Asset, t: Date) => {
      const bar = allBarsByT.get(t.getTime());
      if (!bar) throw new Error(`no bar for ${t.toISOString()}`);
      return { t, price: bar.close };
    },
  });
}

// --- 4. Historical run ----------------------------------------------------

const replayRange = { from: new Date(Date.UTC(2024, 5, 1)), to: new Date(Date.UTC(2024, 5, 15)) };
const replayCache = new MemoryFeatureCache();
const replayFeed = feedFor(HISTORICAL_BARS);
const replayRuntime = new FeatureRuntime({
  dataFeed: replayFeed,
  featureCache: replayCache,
  range: replayRange,
  freq: '1d',
});

const replayResult = await runBacktest({
  strategy: makeStrategy(),
  range: replayRange,
  initialPortfolio: { cash: 10_000, positions: [], t: replayRange.from },
  dataFeed: replayFeed,
  executor: makeExecutor(),
  calendar,
  featureCache: replayCache,
  featureRuntime: replayRuntime, // exposes accumulated bars on result.bars
});

// --- 5. Live ticks --------------------------------------------------------
//
// One tick per session at 23:00 UTC. With Crypto24x7Calendar, each tick at
// 23:00 UTC of day N is in session N. The next tick at 23:00 UTC of day N+1
// crosses the midnight-UTC boundary and triggers runLive to commit a
// snapshot for day N. A sentinel tick on day 22 forces the final snapshot.

const liveTicks: StreamingBar[] = LIVE_BARS.map((b) => ({
  asset: SPY,
  bar: { ...b, t: new Date(b.t.getTime() + 23 * 3600 * 1000) },
}));
liveTicks.push({
  asset: SPY,
  bar: {
    t: new Date(Date.UTC(2024, 5, 22, 0, 1, 0)),
    open: 122,
    high: 122,
    low: 122,
    close: 122,
    volume: 0,
  },
});

const tickFeed: StreamingDataFeed = {
  async *subscribe() {
    for (const t of liveTicks) yield t;
  },
};

// --- 6. Live run with mark/snapshot demux ---------------------------------
//
// In a real chart UI, mark events drive the wiggling rightmost bar (and a
// "if the day ended now, strategy would do X" preview), while snapshot events
// freeze the rightmost bar and append a new one. Here we just count them.

let markCount = 0;
const liveSnapshots: BacktestSnapshot[] = [];
const previewOrdersSeen: string[] = [];

for await (const ev of runLive<Features, S>({
  strategy: makeStrategy(),
  history: replayResult,
  dataFeed: tickFeed,
  executor: makeExecutor(),
  calendar,
})) {
  if (ev.type === 'mark') {
    markCount++;
    // The mark event's previewOrders shows what strategy.build WOULD emit if
    // the session closed at the current tick price. State is snapshotted and
    // restored, so previews never corrupt committed state.
    for (const o of ev.previewOrders) previewOrdersSeen.push(o.id);
  } else if (ev.type === 'snapshot') {
    liveSnapshots.push(ev);
  }
}

// --- 7. Verify continuity + print summary ---------------------------------

const allSnapshots = [...replayResult.snapshots, ...liveSnapshots];
const allOrders = allSnapshots.flatMap((s) => s.orders);
const liveOrders = liveSnapshots.flatMap((s) => s.orders);

console.log('=== replay-then-stream recipe ===');
console.log(`replay snapshots : ${replayResult.snapshots.length}  (sessions 1-14)`);
console.log(`live snapshots   : ${liveSnapshots.length}  (sessions 15-21)`);
console.log(`live mark events : ${markCount}  (per-tick previews + revaluations)`);
console.log(`combined total   : ${allSnapshots.length}`);
console.log('');
console.log(`replay finalState.tickCount : ${replayResult.finalState?.tickCount}  (handed to runLive)`);
const exportedBars = replayResult.bars.get('us:SPY')?.length ?? 0;
console.log(
  `replay bars exported        : ${exportedBars}  (this strategy uses no indicators; real strategies populate this via runtime.compute)`,
);
console.log('');
console.log(`all rebalance orders : ${allOrders.map((o) => o.id).join(', ')}`);
console.log(`live-side orders     : ${liveOrders.map((o) => o.id).join(', ')}  (prove state continuity)`);
console.log('');
console.log(`unique preview orders seen during marks : ${[...new Set(previewOrdersSeen)].join(', ') || '(none)'}`);
console.log('');

const finalCash = allSnapshots.at(-1)?.portfolio.cash ?? 0;
const finalPositions = allSnapshots.at(-1)?.portfolio.positions ?? [];
console.log(`final cash      : $${finalCash.toFixed(2)}`);
console.log('final positions :');
for (const p of finalPositions) {
  console.log(`  ${p.asset.symbol.padEnd(4)} qty=${p.quantity}`);
}
