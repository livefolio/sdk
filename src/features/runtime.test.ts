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
      dataFeed: { bars: vi.fn() },
      featureCache: new MemoryFeatureCache(),
      mode: 'streaming',
      freq: '1d',
    });
    expect(runtime).toBeDefined();
  });

  it('appendBar adds bars to the buffer in ascending order', () => {
    const runtime = new FeatureRuntime({
      dataFeed: { bars: vi.fn() },
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
    ).toThrow(/ascending/);
  });

  it('compute reads from the in-memory buffer, not dataFeed.bars', async () => {
    const barsSpy = vi.fn();
    const runtime = new FeatureRuntime({
      dataFeed: { bars: barsSpy },
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
    expect(barsSpy).not.toHaveBeenCalled();
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
      dataFeed: { bars: vi.fn() },
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
});
