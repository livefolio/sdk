import { describe, it, expect, vi } from 'vitest';
import { FeatureRuntime } from './runtime';
import { MemoryFeatureCache } from '../reference/memory-feature-cache';
import type { DataFeed } from '../interfaces/data-feed';
import type { Asset, Bar } from '../interfaces/types';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };
const range = { from: utc('2026-01-05'), to: utc('2026-01-12') };

const bars: Bar[] = [
  { t: utc('2026-01-05'), open: 99, high: 102, low: 98, close: 100, volume: 1 },
  { t: utc('2026-01-06'), open: 100, high: 103, low: 99, close: 102, volume: 1 },
  { t: utc('2026-01-07'), open: 102, high: 105, low: 101, close: 104, volume: 1 },
  { t: utc('2026-01-08'), open: 104, high: 106, low: 102, close: 105, volume: 1 },
  { t: utc('2026-01-09'), open: 105, high: 108, low: 104, close: 107, volume: 1 },
];

function feed(): { feed: DataFeed; barsCalls: ReturnType<typeof vi.fn> } {
  const barsCalls = vi.fn(async function* (_a, _r, _f) {
    for (const b of bars) yield b;
  });
  return { feed: { bars: barsCalls }, barsCalls };
}

describe('FeatureRuntime', () => {
  it('cache miss: fetches bars, computes, stores, returns', async () => {
    const { feed: df, barsCalls } = feed();
    const cache = new MemoryFeatureCache();
    const rt = new FeatureRuntime({ dataFeed: df, featureCache: cache, range, freq: '1d' });

    const series = await rt.compute({ kind: 'sma', period: 3 }, SPY);
    expect(series).toHaveLength(3);
    expect(series[0]!.v).toBe((100 + 102 + 104) / 3);
    expect(barsCalls).toHaveBeenCalledTimes(1);
  });

  it('cache hit: does not fetch bars', async () => {
    const cache = new MemoryFeatureCache();
    // first run to populate cache
    const { feed: df1 } = feed();
    const rt1 = new FeatureRuntime({ dataFeed: df1, featureCache: cache, range, freq: '1d' });
    await rt1.compute({ kind: 'sma', period: 3 }, SPY);

    // second runtime, same cache: bars should not be called
    const { feed: df2, barsCalls } = feed();
    const rt2 = new FeatureRuntime({ dataFeed: df2, featureCache: cache, range, freq: '1d' });
    const series = await rt2.compute({ kind: 'sma', period: 3 }, SPY);
    expect(series).toHaveLength(3);
    expect(barsCalls).toHaveBeenCalledTimes(0);
  });

  it('shares bars across features for the same asset', async () => {
    const { feed: df, barsCalls } = feed();
    const cache = new MemoryFeatureCache();
    const rt = new FeatureRuntime({ dataFeed: df, featureCache: cache, range, freq: '1d' });

    await Promise.all([
      rt.compute({ kind: 'sma', period: 3 }, SPY),
      rt.compute({ kind: 'ema', period: 3 }, SPY),
      rt.compute({ kind: 'price' }, SPY),
    ]);
    expect(barsCalls).toHaveBeenCalledTimes(1);
  });

  it('throws on unknown feature kind', async () => {
    const { feed: df } = feed();
    const rt = new FeatureRuntime({ dataFeed: df, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    await expect(rt.compute({ kind: 'mystery' as never, period: 1 } as never, SPY)).rejects.toThrow(/unknown/);
  });
});

describe('FeatureRuntime streaming mode', () => {
  const SPY: Asset = { kind: 'equity', id: 'SPY', symbol: 'SPY' };

  it('accepts streaming construction without a fixed range', () => {
    const runtime = new FeatureRuntime({
      featureCache: new MemoryFeatureCache(),
      mode: 'streaming',
      freq: '1d',
    });
    expect(runtime).toBeDefined();
  });

  it('appendBar throws when bar.t is strictly less than the buffered tail', () => {
    const runtime = new FeatureRuntime({
      featureCache: new MemoryFeatureCache(),
      mode: 'streaming',
      freq: '1d',
    });
    runtime.appendBar(SPY, { t: new Date('2024-06-01'), open: 100, high: 100, low: 100, close: 100, volume: 0 });
    runtime.appendBar(SPY, { t: new Date('2024-06-02'), open: 101, high: 101, low: 101, close: 101, volume: 0 });
    expect(() =>
      runtime.appendBar(SPY, {
        t: new Date('2024-06-01'),
        open: 99,
        high: 99,
        low: 99,
        close: 99,
        volume: 0,
      }),
    ).toThrow(/non-decreasing/);
  });

  it('appendBar with same-t replaces the buffered tail in place (wiggle)', async () => {
    const runtime = new FeatureRuntime({
      featureCache: new MemoryFeatureCache(),
      mode: 'streaming',
      freq: '1d',
    });
    const t1 = new Date('2024-06-01');
    const t2 = new Date('2024-06-02');
    runtime.appendBar(SPY, { t: t1, open: 100, high: 100, low: 100, close: 100, volume: 0 });
    runtime.appendBar(SPY, { t: t2, open: 101, high: 101, low: 101, close: 101, volume: 0 });
    // Wiggle the in-flight bar at t2 — same t, updated close.
    runtime.appendBar(SPY, { t: t2, open: 101, high: 105, low: 100, close: 104, volume: 0 });
    runtime.appendBar(SPY, { t: t2, open: 101, high: 105, low: 99, close: 103, volume: 0 });

    const bars = runtime.getBars(SPY);
    expect(bars).toHaveLength(2);
    expect(bars[1]!.close).toBe(103);
    expect(bars[1]!.high).toBe(105);
    expect(bars[1]!.low).toBe(99);

    // SMA(2) over [100, 103] = 101.5. Confirms the cache invalidation path
    // fires after each replacement so compute reads the wiggled close.
    const series = await runtime.compute({ kind: 'sma', period: 2 }, SPY);
    expect(series.length).toBe(1);
    expect(series[0]!.v).toBe(101.5);
  });

  it('compute reads from the in-memory buffer, not dataFeed.bars', async () => {
    const runtime = new FeatureRuntime({
      featureCache: new MemoryFeatureCache(),
      mode: 'streaming',
      freq: '1d',
    });
    for (let i = 0; i < 5; i++) {
      runtime.appendBar(SPY, {
        t: new Date(Date.UTC(2024, 5, i + 1)),
        open: 100 + i,
        high: 100 + i,
        low: 100 + i,
        close: 100 + i,
        volume: 0,
      });
    }
    const series = await runtime.compute({ kind: 'sma', period: 3 }, SPY);
    // SMA(3) over [100, 101, 102, 103, 104] yields 3 values: 101, 102, 103.
    expect(series.length).toBe(3);
  });

  it('initialBars seeds the streaming buffer', async () => {
    const initialBars = new Map<string, Bar[]>([
      [
        'SPY',
        Array.from({ length: 5 }, (_, i) => ({
          t: new Date(Date.UTC(2024, 5, i + 1)),
          open: 100 + i,
          high: 100 + i,
          low: 100 + i,
          close: 100 + i,
          volume: 0,
        })),
      ],
    ]);
    const runtime = new FeatureRuntime({
      featureCache: new MemoryFeatureCache(),
      mode: 'streaming',
      freq: '1d',
      initialBars,
    });
    const series = await runtime.compute({ kind: 'sma', period: 3 }, SPY);
    expect(series.length).toBe(3);
  });

  it('appendBar throws when called on historical-mode FeatureRuntime', () => {
    const runtime = new FeatureRuntime({
      dataFeed: { bars: vi.fn() },
      featureCache: new MemoryFeatureCache(),
      range: { from: new Date('2024-06-01'), to: new Date('2024-06-30') },
      freq: '1d',
    });
    expect(() =>
      runtime.appendBar(SPY, { t: new Date('2024-06-01'), open: 1, high: 1, low: 1, close: 1, volume: 0 }),
    ).toThrow(/streaming mode/);
  });

  it('appendBar invalidates seriesCache so subsequent compute reflects new bars', async () => {
    const runtime = new FeatureRuntime({
      mode: 'streaming',
      featureCache: new MemoryFeatureCache(),
      freq: '1d',
    });
    for (let i = 0; i < 3; i++) {
      runtime.appendBar(SPY, {
        t: new Date(Date.UTC(2024, 5, i + 1)),
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 0,
      });
    }
    const s1 = await runtime.compute({ kind: 'sma', period: 3 }, SPY);
    expect(s1.length).toBe(1);

    runtime.appendBar(SPY, {
      t: new Date(Date.UTC(2024, 5, 4)),
      open: 200,
      high: 200,
      low: 200,
      close: 200,
      volume: 0,
    });
    const s2 = await runtime.compute({ kind: 'sma', period: 3 }, SPY);
    expect(s2.length).toBe(2);
    // Last value should reflect the new bar: SMA(100, 100, 200) = 133.33...
    expect(s2[s2.length - 1]?.v).toBeCloseTo(133.333, 2);
  });
});

describe('FeatureRuntime bar accessors', () => {
  const SPY: Asset = { kind: 'equity', id: 'SPY', symbol: 'SPY' };
  const TLT: Asset = { kind: 'equity', id: 'TLT', symbol: 'TLT' };

  it('getBars returns the buffered bars for an asset (streaming)', () => {
    const runtime = new FeatureRuntime({
      mode: 'streaming',
      featureCache: new MemoryFeatureCache(),
      freq: '1d',
    });
    runtime.appendBar(SPY, { t: new Date('2024-06-01'), open: 1, high: 1, low: 1, close: 1, volume: 0 });
    expect(runtime.getBars(SPY)).toHaveLength(1);
  });

  it('getBars returns empty array for an asset that has no bars', () => {
    const runtime = new FeatureRuntime({
      mode: 'streaming',
      featureCache: new MemoryFeatureCache(),
      freq: '1d',
    });
    expect(runtime.getBars(SPY)).toEqual([]);
  });

  it('getAllBars returns the full per-asset map (streaming)', () => {
    const runtime = new FeatureRuntime({
      mode: 'streaming',
      featureCache: new MemoryFeatureCache(),
      freq: '1d',
    });
    runtime.appendBar(SPY, { t: new Date('2024-06-01'), open: 1, high: 1, low: 1, close: 1, volume: 0 });
    runtime.appendBar(TLT, { t: new Date('2024-06-01'), open: 2, high: 2, low: 2, close: 2, volume: 0 });
    const all = runtime.getAllBars();
    expect(all.size).toBe(2);
    expect(all.get('SPY')).toHaveLength(1);
    expect(all.get('TLT')).toHaveLength(1);
  });

  it('getBars returns historical-mode bars after compute fetches them', async () => {
    const SPY_BARS: Bar[] = [
      { t: new Date('2024-06-01'), open: 100, high: 100, low: 100, close: 100, volume: 0 },
      { t: new Date('2024-06-02'), open: 101, high: 101, low: 101, close: 101, volume: 0 },
    ];
    const dataFeed: DataFeed = {
      bars: vi.fn().mockImplementation(async function* () {
        for (const b of SPY_BARS) yield b;
      }),
    };
    const runtime = new FeatureRuntime({
      dataFeed,
      featureCache: new MemoryFeatureCache(),
      range: { from: new Date('2024-06-01'), to: new Date('2024-06-03') },
      freq: '1d',
    });
    expect(runtime.getBars(SPY)).toEqual([]); // no fetch yet
    await runtime.compute({ kind: 'sma', period: 1 }, SPY);
    expect(runtime.getBars(SPY)).toHaveLength(2); // fetched + cached
  });
});
