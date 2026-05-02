import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { createClient } from '@livefolio/sdk';
import { fromSpec } from '@livefolio/sdk/tactical';
import { runBacktest } from '@livefolio/sdk/strategy';
import { FeatureRuntime } from '@livefolio/sdk/features';
import { USEquityCalendar, MemoryFeatureCache, BacktestExecutor } from '@livefolio/sdk/reference';
import type { Asset, Bar, DateRange, Frequency } from '@livefolio/sdk/interfaces';
import { YfinanceDataFeed } from '@livefolio/datafeed-yfinance';

import { buildV3Strategy, PARITY_SPEC, PARITY_RANGE, PARITY_RANGE_V3 } from './strategy';
import { FixtureMarketProvider, makeInMemoryStorage, tradingDaysFromBars } from './v3-fixture-providers';
import { extractV3History, extractV4History } from './extract-history';
import { compareAllocationHistories } from './diff';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, '../fixtures');

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
  const path = resolve(FIXTURE_DIR, `${symbol}-2020-2024.json`);
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
  it('produces identical allocation histories on SPY/QQQ/IEF 2020-06 → 2024-12', async () => {
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
    const calendar = new USEquityCalendar();
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
    const runtime = new FeatureRuntime({
      dataFeed,
      featureCache: cache,
      range: PARITY_RANGE,
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
    const histA = extractV3History(v3Bars);
    // Build sorted date arrays per symbol for fallback lookup when a snapshot
    // date falls past the last fixture bar (e.g. the calendar generates sessions
    // that extend slightly beyond the fixture's last bar date).
    const closeSortedBySym = new Map<string, { date: string; close: number }[]>();
    for (const [sym, bars] of barsBySym) {
      const sorted = bars
        .map((b) => ({ date: b.t.toISOString().slice(0, 10), close: b.close }))
        .sort((a, b) => a.date.localeCompare(b.date));
      closeSortedBySym.set(sym, sorted);
    }
    const symFromAssetId = (id: string) => id.replace(/^us:/, '');
    const histB = extractV4History(result, (assetId, date) => {
      const sym = symFromAssetId(assetId);
      const sorted = closeSortedBySym.get(sym);
      if (!sorted) throw new Error(`no fixture for ${sym}`);
      // Binary search for exact date; fall back to most recent prior bar.
      let lo = 0;
      let hi = sorted.length - 1;
      let best: number | undefined;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const cmp = sorted[mid]!.date.localeCompare(date);
        if (cmp === 0) return sorted[mid]!.close;
        if (cmp < 0) {
          best = sorted[mid]!.close;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (best !== undefined) return best;
      throw new Error(`no close for ${sym} on or before ${date}`);
    });

    const report = compareAllocationHistories(histA, histB, {
      weightTolerance: 1e-6,
    });

    if (report.diffs.length > 0 || report.onlyInA.length > 0 || report.onlyInB.length > 0) {
      console.log('parity diff (first 10):', JSON.stringify(report.diffs.slice(0, 10), null, 2));

      console.log('only in v0.3:', report.onlyInA.slice(0, 10));

      console.log('only in v0.4:', report.onlyInB.slice(0, 10));

      console.log('matched cells:', report.matched);

      console.log('v3 history length:', histA.length, '/ v4:', histB.length);
    }

    expect(report.diffs).toEqual([]);
    expect(report.onlyInA).toEqual([]);
    expect(report.onlyInB).toEqual([]);
    expect(report.matched).toBeGreaterThan(0);
  });
});
