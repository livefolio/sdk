// Parity verification: v0.4 ports of the four featured strategies vs the
// v0.3 production allocation history stored in Supabase.
//
// All bars come from `@livefolio/yfinance` over the network — no fixtures, no
// stubs. The v0.3 ground-truth is loaded from
// `parity/fixtures/v3-featured-strategies-2023-2024.json` (a snapshot of
// `strategies_series` for the four highlighted strategies over
// 2023-04-03 → 2024-04-01, regenerable with the SQL block at the bottom of
// this file).
//
// For each strategy the script runs a v0.4 backtest, infers the chosen rule
// branch per session from the orders, and compares against the v0.3
// allocation_id mapped to the same branch labels.
//
//   npx tsx parity/src/featured-strategies-parity.ts

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { TacticalSpec, Asset, AssetId, DateRange, BacktestSnapshot } from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/yfinance';

// --- 1. Load v0.3 ground-truth --------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(here, '../fixtures/v3-featured-strategies-2023-2024.json');
const v3History = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Record<string, Record<string, number>>;

// --- 2. Strategy specs (mirror scripts/docs/recipes/featured-strategies.ts) -

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

const goldenButterflyTactical: TacticalSpec = {
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
};

const trendRocket: TacticalSpec = {
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
};

const crisisReadyTurbo: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [UGL, KMLM, UPRO],
  rebalance: { frequency: 'Daily' },
  features: [],
  rules: { op: 'allocate', weights: { 'us:UGL': 0.33, 'us:KMLM': 0.33, 'us:UPRO': 0.34 } },
};

const leveragedMovingAverage: TacticalSpec = {
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
    else: {
      op: 'allocate',
      weights: { 'us:TQQQ': 0.6, 'us:UGL': 0.15, 'us:KMLM': 0.15, 'us:ZROZ': 0.1 },
    },
  },
};

// --- 3. v0.3 allocation_id → branch label ---------------------------------
//
// 1746=TQQQ-only      → rsi-low      (Golden Butterfly RSI<30)
// 1747=SQQQ-only      → rsi-high     (Golden Butterfly RSI>80)
// 1748=5sleeve-w-TQQQ → trend-on
// 1749=5sleeve-no-TQQQ→ trend-off
// 1637=UGL/TQQQ/UPRO  → risk-on      (Trend Rocket)
// 1638=AGG/GLD/SPY    → defensive    (Trend Rocket)
// 1773=UGL/KMLM/UPRO  → static       (Crisis Ready Turbo)
// 1666=UGL/KMLM/ZROZ  → defensive    (Leveraged MA)
// 1667=TQQQ-heavy     → risk-on      (Leveraged MA)

type Branch = 'rsi-low' | 'rsi-high' | 'trend-on' | 'trend-off' | 'risk-on' | 'defensive' | 'static';

const v3BranchByAllocId: Record<number, Branch> = {
  1746: 'rsi-low',
  1747: 'rsi-high',
  1748: 'trend-on',
  1749: 'trend-off',
  1637: 'risk-on',
  1638: 'defensive',
  1773: 'static',
  1666: 'defensive',
  1667: 'risk-on',
};

// Branch detection from v0.4 post-fill positions. Each strategy's branches
// hold disjoint asset sleeves so the held set uniquely identifies the branch.
type PositionLike = { readonly asset: { id: AssetId }; readonly quantity: number };

function held(positions: ReadonlyArray<PositionLike>): Set<AssetId> {
  const out = new Set<AssetId>();
  for (const p of positions) if (p.quantity !== 0) out.add(p.asset.id);
  return out;
}
function gbBranch(positions: ReadonlyArray<PositionLike>): Branch | null {
  const ids = held(positions);
  if (ids.size === 0) return null;
  if (ids.has('us:SQQQ')) return 'rsi-high';
  if (ids.size === 1 && ids.has('us:TQQQ')) return 'rsi-low';
  if (ids.has('us:TQQQ')) return 'trend-on';
  return 'trend-off';
}
function trBranch(positions: ReadonlyArray<PositionLike>): Branch | null {
  const ids = held(positions);
  if (ids.size === 0) return null;
  return ids.has('us:TQQQ') ? 'risk-on' : 'defensive';
}
function lmaBranch(positions: ReadonlyArray<PositionLike>): Branch | null {
  const ids = held(positions);
  if (ids.size === 0) return null;
  return ids.has('us:TQQQ') ? 'risk-on' : 'defensive';
}

// --- 4. Live yfinance feed + shared runtime -------------------------------

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const calendar = new NYSEExchangeCalendar();
const range: DateRange = { from: utc('2023-04-01'), to: utc('2024-04-02') };
// Wide runtime range: SMA(200) needs ~1 year of warmup, and the executor's
// next-open lookup wants bars past the backtest range. YfinanceDataFeed's
// per-instance bar cache only allows identical re-fetches, so the executor
// reuses this exact range to stay on the cache hot path.
const runtimeRange: DateRange = { from: utc('2020-01-02'), to: utc('2024-05-01') };

const dataFeed = new YfinanceDataFeed();

function makeExecutor(): BacktestExecutor {
  return new BacktestExecutor({
    calendar,
    nextOpen: async (asset: Asset, t: Date) => {
      for await (const bar of dataFeed.bars(asset, runtimeRange, '1d')) {
        if (bar.t.getTime() > t.getTime()) return { t: bar.t, price: bar.open };
      }
      throw new Error(`featured-strategies-parity: no next-open for ${asset.symbol} after ${t.toISOString()}`);
    },
  });
}

// --- 5. Per-strategy parity check -----------------------------------------

async function runOne(
  name: string,
  v3StrategyId: string,
  spec: TacticalSpec,
  branchOf: (positions: ReadonlyArray<PositionLike>) => Branch | null,
): Promise<{ name: string; agree: number; disagree: number; total: number }> {
  const featureCache = new MemoryFeatureCache();
  const runtime = new FeatureRuntime({ dataFeed, featureCache, range: runtimeRange, freq: '1d' });
  const strategy = fromSpec(spec, { runtime, calendar });

  const result = await runBacktest({
    strategy,
    range,
    initialPortfolio: { cash: 100_000, positions: [], t: range.from },
    dataFeed,
    executor: makeExecutor(),
    calendar,
  });

  const v3 = v3History[v3StrategyId];
  if (!v3) throw new Error(`no v0.3 history for strategy ${v3StrategyId}`);

  let agree = 0;
  let disagree = 0;
  const disagreements: { d: string; v3: Branch; v4: Branch }[] = [];

  for (const snap of result.snapshots as BacktestSnapshot[]) {
    const d = snap.t.toISOString().slice(0, 10);
    const v4Branch = branchOf(snap.portfolio.positions);
    if (!v4Branch) continue;

    const v3AllocId = v3[d];
    if (v3AllocId === undefined) continue;
    const v3Branch = v3BranchByAllocId[v3AllocId];
    if (!v3Branch) {
      console.warn(`  [warn] unknown v0.3 allocation ${v3AllocId} on ${d}`);
      continue;
    }

    if (v3Branch === v4Branch) agree++;
    else {
      disagree++;
      if (disagreements.length < 8) disagreements.push({ d, v3: v3Branch, v4: v4Branch });
    }
  }

  const total = agree + disagree;
  const pct = total === 0 ? 'n/a' : `${((agree / total) * 100).toFixed(1)}%`;
  console.log(`--- ${name} ---`);
  console.log(`  sessions   : ${result.snapshots.length}`);
  console.log(`  compared   : ${total}`);
  console.log(`  agree      : ${agree}    (${pct})`);
  console.log(`  disagree   : ${disagree}`);
  if (disagreements.length > 0) {
    console.log(`  disagreements (first 8):`);
    for (const dx of disagreements) console.log(`    ${dx.d}  v0.3=${dx.v3}  v0.4=${dx.v4}`);
  }
  console.log('');

  return { name, agree, disagree, total };
}

console.log('=== featured-strategies parity verification (live yfinance vs v0.3) ===');
console.log(`range: ${range.from.toISOString().slice(0, 10)} → ${range.to.toISOString().slice(0, 10)}\n`);

const results = [
  await runOne('Golden Butterfly Tactical (id=316)', '316', goldenButterflyTactical, gbBranch),
  await runOne('Trend Rocket (id=317)', '317', trendRocket, trBranch),
  await runOne('Crisis Ready Turbo (id=318)', '318', crisisReadyTurbo, () => 'static'),
  await runOne('Leveraged Moving Average (id=319)', '319', leveragedMovingAverage, lmaBranch),
];

console.log('=== summary ===');
for (const r of results) {
  const pct = r.total === 0 ? 'n/a' : `${((r.agree / r.total) * 100).toFixed(2)}%`;
  console.log(`  ${r.name.padEnd(40)} ${r.agree}/${r.total}  ${pct}`);
}

// To regenerate parity/fixtures/v3-featured-strategies-2023-2024.json from a
// running local Supabase:
//
//   psql -At -c "
//     SELECT json_object_agg(strat_id::text, hist) FROM (
//       SELECT s.id strat_id,
//              json_object_agg(td.date::text, ss.allocation_id ORDER BY td.date) hist
//       FROM strategies_series ss
//       JOIN strategies s ON s.id=ss.strategies_id
//       JOIN trading_days td ON td.id=ss.trading_day_id
//       WHERE s.is_highlighted=true
//         AND td.date BETWEEN '2023-04-01' AND '2024-04-01'
//       GROUP BY s.id
//     ) x;" \
//     > parity/fixtures/v3-featured-strategies-2023-2024.json
