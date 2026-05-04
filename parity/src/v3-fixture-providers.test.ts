import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FixtureMarketProvider, makeInMemoryStorage, tradingDaysFromBars } from './v3-fixture-providers';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, '../fixtures');

describe('FixtureMarketProvider', () => {
  it('returns ascending DailyBar[] for a known fixture', async () => {
    const market = new FixtureMarketProvider({ fixtureDir: FIXTURE_DIR });
    const bars = await market.fetchBars('SPY');
    expect(bars.length).toBeGreaterThan(1000);
    expect(bars[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bars[0]!.value).toBeGreaterThan(0);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.date > bars[i - 1]!.date).toBe(true);
    }
  });

  it('honors `from` cutoff', async () => {
    const market = new FixtureMarketProvider({ fixtureDir: FIXTURE_DIR });
    const bars = await market.fetchBars('SPY', '2024-01-01');
    expect(bars[0]!.date >= '2024-01-01').toBe(true);
  });

  it('throws on missing fixture', async () => {
    const market = new FixtureMarketProvider({ fixtureDir: FIXTURE_DIR });
    await expect(market.fetchBars('NOPE')).rejects.toThrow(/no fixture for NOPE/);
  });

  it('caches per-symbol reads (same instance across calls)', async () => {
    const market = new FixtureMarketProvider({ fixtureDir: FIXTURE_DIR });
    const a = await market.fetchBars('SPY');
    const b = await market.fetchBars('SPY');
    expect(a).toBe(b); // strict identity — cache returns same reference
  });
});

describe('tradingDaysFromBars', () => {
  it('produces sorted union of dates', () => {
    const days = tradingDaysFromBars(
      [
        { date: '2024-01-03', value: 1 },
        { date: '2024-01-02', value: 1 },
      ],
      [{ date: '2024-01-02', value: 2 }],
    );
    expect(days).toEqual(['2024-01-02', '2024-01-03']);
  });
});

describe('InMemoryStorageProvider (via makeInMemoryStorage)', () => {
  it('round-trips an indicator series', async () => {
    const { storage } = makeInMemoryStorage(['2024-01-02', '2024-01-03']);
    const id = (
      await storage.indicators.findOrCreate({
        type: 'SMA',
        tickerId: 1,
        lookback: 20,
        delay: 0,
        unit: null,
        threshold: null,
      })
    ).id;
    await storage.indicators.writeSeries(id, [
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 101 },
    ]);
    const back = await storage.indicators.getSeries(id);
    expect(back.map((b) => b.value)).toEqual([100, 101]);
  });
});
