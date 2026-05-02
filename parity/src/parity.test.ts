import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { createClient } from './v3/client';
import {
  fromSpec,
  runBacktest,
  FeatureRuntime,
  NYSEExchangeCalendar,
  MemoryFeatureCache,
  BacktestExecutor,
} from '@livefolio/sdk';
import type { Asset, Bar, DateRange, Frequency } from '@livefolio/sdk';
import { YfinanceDataFeed } from '@livefolio/datafeed-yfinance';

import { buildV3Strategy, PARITY_SPEC, PARITY_RANGE, PARITY_RANGE_V3 } from './strategy';
import { FixtureMarketProvider, makeInMemoryStorage, tradingDaysFromBars } from './v3-fixture-providers';
import { extractV3History, extractV4TargetHistory } from './extract-history';
import { compareAllocationHistories } from './diff';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, '../fixtures');

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

interface YfinanceFixtureFile {
  symbol: string;
  range: { from: string; to: string };
  bars: ReadonlyArray<{
    t: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

function loadYfinanceBars(symbol: string): Bar[] {
  const path = resolve(FIXTURE_DIR, `${symbol}-2020-2026.json`);
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as YfinanceFixtureFile;
  return parsed.bars.map((b) => ({
    t: new Date(b.t),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

describe('parity gate: v0.3 fluent API ↔ tactical/v0 spec', () => {
  it('produces identical allocation histories on SPY/QQQ/IEF 2020-06 → 2026-05', async () => {
    // ---- v0.3 wiring -----------------------------------------------------
    const market = new FixtureMarketProvider({ fixtureDir: FIXTURE_DIR });
    const spyBars3 = await market.fetchBars('SPY');
    const qqqBars3 = await market.fetchBars('QQQ');
    const iefBars3 = await market.fetchBars('IEF');
    const tradingDays = tradingDaysFromBars(spyBars3, qqqBars3, iefBars3).filter(
      (d) => d >= PARITY_RANGE_V3.from && d <= PARITY_RANGE_V3.to,
    );
    const { storage } = makeInMemoryStorage(tradingDays);
    const client = createClient({ storage, market });
    const strategy3 = buildV3Strategy(client);
    await (strategy3 as unknown as { resolve: () => Promise<unknown> }).resolve();
    const portfolio3 = client.portfolio([client.ticker('CASHX'), 100_000]);
    await strategy3.simulate({
      from: PARITY_RANGE_V3.from,
      to: PARITY_RANGE_V3.to,
      portfolio: portfolio3,
    });
    const v3Bars = await strategy3.series({
      from: PARITY_RANGE_V3.from,
      to: PARITY_RANGE_V3.to,
    });

    // ---- v0.4 wiring -----------------------------------------------------
    const spyBars4 = loadYfinanceBars('SPY');
    const qqqBars4 = loadYfinanceBars('QQQ');
    const iefBars4 = loadYfinanceBars('IEF');
    const barsBySym = new Map<string, Bar[]>([
      ['SPY', spyBars4],
      ['QQQ', qqqBars4],
      ['IEF', iefBars4],
    ]);
    const calendar = new NYSEExchangeCalendar();
    const cache = new MemoryFeatureCache();
    const dataFeed = new YfinanceDataFeed({
      fetcher: async (
        symbol: string,
        range: DateRange,
        _freq: Frequency,
        _opts: { includeIncompleteToday: boolean },
      ) => {
        const bars = barsBySym.get(symbol);
        if (!bars) throw new Error(`no fixture for ${symbol}`);
        return bars.filter((b) => b.t >= range.from && b.t < range.to);
      },
    });
    // The FeatureRuntime range determines how much price history is loaded
    // for indicator computation. SMA200 needs ~200 prior trading days; widen
    // the lower bound to the fixture's start so SMA warmup matches v0.3
    // (which fetches all available bars from MarketProvider with no filter).
    const runtime = new FeatureRuntime({
      dataFeed,
      featureCache: cache,
      range: { from: utc('2020-01-02'), to: PARITY_RANGE.to },
      freq: '1d',
    });
    const executor = new BacktestExecutor({
      calendar,
      nextOpen: async (asset: Asset, t: Date) => {
        const bars = barsBySym.get(asset.symbol);
        if (!bars) throw new Error(`no fixture for ${asset.symbol}`);
        const next = bars.find((b) => b.t.getTime() > t.getTime());
        return next ? { t: next.t, price: next.open } : { t, price: bars.at(-1)!.close };
      },
    });
    const result = await runBacktest({
      strategy: fromSpec(PARITY_SPEC, { runtime, calendar }),
      range: PARITY_RANGE,
      initialPortfolio: { cash: 100_000, positions: [], t: PARITY_RANGE.from },
      dataFeed,
      executor,
      calendar,
    });

    // ---- extraction & diff -----------------------------------------------
    // TARGET-vs-TARGET methodology: both engines compute the same rule-tree
    // target on the same features, so the diff should be ~zero on shared
    // dates. See docs/specs/2026-05-02-v0.4-parity-divergences.md.
    const histA = extractV3History(v3Bars);
    const histBFull = await extractV4TargetHistory({
      result,
      spec: PARITY_SPEC,
      runtime,
      calendar,
    });

    // ---- structural date allowances -------------------------------------
    // Two date-set divergences require explicit handling. Each is documented
    // in docs/specs/2026-05-02-v0.4-parity-divergences.md.
    //
    // 1. Range clipping (warmup + boundary):
    //    a. SMA200 warmup: v0.3 evaluates the rule tree from day 1 — when the
    //       trend signal is undefined (SMA200 still warming up), v0.3's
    //       evaluator coerces it to `false` (see src/computations/strategy.ts
    //       line 76: `signalSeries.get(id)?.get(date) ?? false`) and the
    //       defensive branch fires. v0.4 (fromSpec) instead skips evaluation
    //       entirely while any feature is undefined. Both behaviors are
    //       intentional. We scope the comparison to dates where v0.4 has a
    //       computed target (i.e. SMA200 has a value AND we've seen at least
    //       one rebalance day) — that's the regime both engines genuinely
    //       agree on. This excludes the ~92 warmup days where v0.3 emits a
    //       defensive IEF=1 and v0.4 emits nothing.
    //    b. Boundary clip: the v0.4 calendar can generate sessions past the
    //       fixture's last bar when PARITY_RANGE.to falls on a non-session
    //       day. Clip the upper bound to min(v3Last, v4Last) so we only
    //       compare dates both engines actually produced.
    const v4FirstWithTarget = histBFull.find((d) => Object.keys(d.weights).length > 0)?.date;
    if (!v4FirstWithTarget) throw new Error('parity: v0.4 produced no target weights');
    const v3First = histA[0]?.date ?? '';
    const v3Last = histA.at(-1)?.date ?? '';
    const v4Last = histBFull.at(-1)?.date ?? '';
    const compareFrom = v4FirstWithTarget > v3First ? v4FirstWithTarget : v3First;
    const compareTo = v3Last < v4Last ? v3Last : v4Last;

    const filterByRange = <T extends { date: string }>(rows: ReadonlyArray<T>): T[] =>
      rows.filter((r) => r.date >= compareFrom && r.date <= compareTo);

    const histAClipped = filterByRange(histA);
    const histBClipped = filterByRange(histBFull);

    const report = compareAllocationHistories(histAClipped, histBClipped, {
      weightTolerance: 1e-6,
    });

    if (report.diffs.length > 0 || report.onlyInA.length > 0 || report.onlyInB.length > 0) {
      console.log('parity diff count:', report.diffs.length);
      console.log('parity diff (first 20):', JSON.stringify(report.diffs.slice(0, 20), null, 2));
      console.log('only in v0.3:', report.onlyInA.slice(0, 20));
      console.log('only in v0.4:', report.onlyInB.slice(0, 20));
      console.log('matched cells:', report.matched);
      console.log(
        'v3 (clipped):',
        histAClipped.length,
        '/ v4 (clipped):',
        histBClipped.length,
        '| compareFrom:',
        compareFrom,
        'compareTo:',
        compareTo,
      );
    }

    expect(report.diffs).toEqual([]);
    expect(report.onlyInA).toEqual([]);
    expect(report.onlyInB).toEqual([]);
    expect(report.matched).toBeGreaterThan(0);
  });
});
