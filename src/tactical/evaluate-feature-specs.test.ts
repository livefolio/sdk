import { describe, it, expect, vi } from 'vitest';
import { evaluateFeatureSpecs } from './evaluate-feature-specs';
import { FeatureRuntime } from '../features/runtime';
import { MemoryFeatureCache } from '../reference/memory-feature-cache';
import type { DataFeed } from '../interfaces/data-feed';
import type { Bar } from '../interfaces/types';
import type { TacticalFeatureSpec } from './types';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const SPY_REF = { id: 'us:SPY', symbol: 'SPY' };
const AGG_REF = { id: 'us:AGG', symbol: 'AGG' };
const range = { from: utc('2026-01-05'), to: utc('2026-01-12') };

function bars(close: number[]): Bar[] {
  return close.map((c, i) => ({
    t: utc(`2026-01-0${5 + i}`),
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
  }));
}

function feedFor(map: Record<string, Bar[]>) {
  const calls = vi.fn(async function* (asset, _r, _f) {
    for (const b of map[asset.id] ?? []) yield b;
  });
  const feed: DataFeed = { bars: calls };
  return { feed, calls };
}

describe('evaluateFeatureSpecs', () => {
  it('returns one entry per spec, keyed by id', async () => {
    const { feed } = feedFor({ 'us:SPY': bars([100, 101, 102, 103, 104]) });
    const rt = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const specs: TacticalFeatureSpec[] = [
      { id: 'spy_price', kind: 'price', asset: SPY_REF },
      { id: 'spy_sma3', kind: 'sma', asset: SPY_REF, period: 3 },
    ];
    const out = await evaluateFeatureSpecs(specs, rt, utc('2026-01-09'));
    expect(out.get('spy_price')).toBe(104);
    expect(out.get('spy_sma3')).toBe((102 + 103 + 104) / 3);
  });

  it('shares one bars fetch across multiple specs for the same asset', async () => {
    const { feed, calls } = feedFor({ 'us:SPY': bars([100, 101, 102, 103, 104]) });
    const rt = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    await evaluateFeatureSpecs(
      [
        { id: 'p', kind: 'price', asset: SPY_REF },
        { id: 's', kind: 'sma', asset: SPY_REF, period: 3 },
        { id: 'e', kind: 'ema', asset: SPY_REF, period: 3 },
      ],
      rt,
      utc('2026-01-09'),
    );
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('fetches once per asset across mixed-asset specs', async () => {
    const { feed, calls } = feedFor({
      'us:SPY': bars([100, 101, 102, 103, 104]),
      'us:AGG': bars([50, 50, 50, 50, 50]),
    });
    const rt = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    await evaluateFeatureSpecs(
      [
        { id: 'p_spy', kind: 'price', asset: SPY_REF },
        { id: 'p_agg', kind: 'price', asset: AGG_REF },
      ],
      rt,
      utc('2026-01-09'),
    );
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('returns undefined for an underflowing feature', async () => {
    const { feed } = feedFor({ 'us:SPY': bars([100, 101, 102, 103, 104]) });
    const rt = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const out = await evaluateFeatureSpecs(
      [{ id: 'sma10', kind: 'sma', asset: SPY_REF, period: 10 }],
      rt,
      utc('2026-01-09'),
    );
    expect(out.has('sma10')).toBe(true);
    expect(out.get('sma10')).toBeUndefined();
  });

  it('throws on duplicate ids', async () => {
    const { feed } = feedFor({ 'us:SPY': bars([100, 101, 102, 103, 104]) });
    const rt = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    await expect(
      evaluateFeatureSpecs(
        [
          { id: 'dup', kind: 'price', asset: SPY_REF },
          { id: 'dup', kind: 'sma', asset: SPY_REF, period: 3 },
        ],
        rt,
        utc('2026-01-09'),
      ),
    ).rejects.toThrow(/duplicate feature id "dup"/);
  });

  it('delay 0 equals no delay', async () => {
    const { feed } = feedFor({ 'us:SPY': bars([100, 101, 102, 103, 104]) });
    const rt = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const out = await evaluateFeatureSpecs(
      [{ id: 'p', kind: 'price', asset: SPY_REF, delay: 0 }],
      rt,
      utc('2026-01-09'),
    );
    expect(out.get('p')).toBe(104);
  });

  it('delay 1 reads the previous-session value', async () => {
    const { feed } = feedFor({ 'us:SPY': bars([100, 101, 102, 103, 104]) });
    const rt = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const out = await evaluateFeatureSpecs(
      [{ id: 'p', kind: 'price', asset: SPY_REF, delay: 1 }],
      rt,
      utc('2026-01-09'),
    );
    expect(out.get('p')).toBe(103);
  });

  it('delay larger than history yields undefined', async () => {
    const { feed } = feedFor({ 'us:SPY': bars([100, 101, 102, 103, 104]) });
    const rt = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    const out = await evaluateFeatureSpecs(
      [{ id: 'p', kind: 'price', asset: SPY_REF, delay: 10 }],
      rt,
      utc('2026-01-09'),
    );
    expect(out.get('p')).toBeUndefined();
  });

  it('throws on negative or non-integer delay', async () => {
    const { feed } = feedFor({ 'us:SPY': bars([100, 101, 102, 103, 104]) });
    const rt = new FeatureRuntime({ dataFeed: feed, featureCache: new MemoryFeatureCache(), range, freq: '1d' });
    await expect(
      evaluateFeatureSpecs([{ id: 'p', kind: 'price', asset: SPY_REF, delay: -1 }], rt, utc('2026-01-09')),
    ).rejects.toThrow(/non-negative integer/);
    await expect(
      evaluateFeatureSpecs([{ id: 'p', kind: 'price', asset: SPY_REF, delay: 1.5 }], rt, utc('2026-01-09')),
    ).rejects.toThrow(/non-negative integer/);
  });
});
