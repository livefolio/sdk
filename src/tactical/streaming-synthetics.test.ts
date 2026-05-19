import { describe, it, expect, vi } from 'vitest';
import { withStreamingSynthetics } from './synthetics';
import type { StreamingDataFeed, StreamingBar } from '../interfaces/streaming-data-feed';
import type { Asset, Bar } from '../interfaces/types';
import type { SyntheticAsset } from './types';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const SPY_REF = { id: 'us:SPY', symbol: 'SPY' } as const;
const SPY3X: SyntheticAsset = {
  id: 'us:SPY_3X',
  symbol: 'SPY_3X',
  underlying: SPY_REF,
  leverage: 3,
};

function bar(t: string, close: number, volume = 0): Bar {
  return { t: utc(t), open: close, high: close, low: close, close, volume };
}

/**
 * Build a mock StreamingDataFeed whose `subscribe(assets)` emits the supplied
 * ticks _filtered_ to assets the caller asked for (mirrors how a real feed
 * only yields for subscribed ids). The mock fn is exposed so tests can assert
 * which upstream assets were subscribed.
 */
function mockFeed(ticks: StreamingBar[]) {
  const subscribe = vi.fn(async function* (assets: ReadonlyArray<Asset>) {
    const ids = new Set(assets.map((a) => a.id));
    for (const t of ticks) {
      if (ids.has(t.asset.id)) yield t;
    }
  });
  const feed: StreamingDataFeed = { subscribe };
  return { feed, subscribe };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

const SPY: Asset = { kind: 'equity', id: 'us:SPY', symbol: 'SPY' };
const SPY_3X_ASSET: Asset = { kind: 'equity', id: 'us:SPY_3X', symbol: 'SPY_3X' };

describe('withStreamingSynthetics', () => {
  it('passes non-synthetic ticks through unchanged', async () => {
    const agg: StreamingBar = {
      asset: { kind: 'equity', id: 'us:AGG', symbol: 'AGG' },
      bar: bar('2026-01-05', 50),
    };
    const { feed } = mockFeed([agg]);
    const wrapped = withStreamingSynthetics(feed, [SPY3X], { seedLastCloses: new Map() });
    const out = await collect(wrapped.subscribe([agg.asset]));
    expect(out).toEqual([agg]);
  });

  it('subscribes the underlying when a synthetic id is requested', async () => {
    const { feed, subscribe } = mockFeed([]);
    const wrapped = withStreamingSynthetics(feed, [SPY3X], { seedLastCloses: new Map() });
    await collect(wrapped.subscribe([SPY_3X_ASSET]));
    expect(subscribe).toHaveBeenCalledTimes(1);
    const askedFor = (subscribe.mock.calls[0]![0] as ReadonlyArray<Asset>).map((a) => a.id);
    expect(askedFor).toEqual(['us:SPY']);
  });

  it('emits a synthesized tick on each underlying tick — leverage 2x doubles return', async () => {
    const ticks: StreamingBar[] = [bar('2026-01-05', 100), bar('2026-01-06', 105)].map((b) => ({
      asset: SPY,
      bar: b,
    }));
    const { feed } = mockFeed(ticks);
    const lev2: SyntheticAsset = { id: 'us:SPY_2X', symbol: 'SPY_2X', underlying: SPY_REF, leverage: 2 };
    const wrapped = withStreamingSynthetics(feed, [lev2], {
      seedLastCloses: new Map([
        ['us:SPY', 100],
        ['us:SPY_2X', 100],
      ]),
    });
    const out = await collect(wrapped.subscribe([{ kind: 'equity', id: 'us:SPY_2X', symbol: 'SPY_2X' }]));
    expect(out).toHaveLength(2);
    expect(out[0]!.asset.id).toBe('us:SPY_2X');
    // First tick: seed says prev underlying = 100, prev synth = 100, current = 100 → 100 × (1 + 2 × 0) = 100.
    expect(out[0]!.bar.close).toBeCloseTo(100, 9);
    // Second tick: 100 → 105 = +5%; doubled = +10% → 110.
    expect(out[1]!.bar.close).toBeCloseTo(110, 9);
  });

  it('seeded synthetic continues smoothly from history (no jump on first tick)', async () => {
    const ticks: StreamingBar[] = [{ asset: SPY, bar: bar('2026-01-06', 102) }];
    const { feed } = mockFeed(ticks);
    const wrapped = withStreamingSynthetics(feed, [SPY3X], {
      seedLastCloses: new Map([
        ['us:SPY', 100],
        ['us:SPY_3X', 250], // assume synthetic finished history at 250
      ]),
    });
    const out = await collect(wrapped.subscribe([SPY_3X_ASSET]));
    // r = (102 - 100) / 100 = 0.02; synth = 250 × (1 + 3 × 0.02) = 250 × 1.06 = 265.
    expect(out[0]!.bar.close).toBeCloseTo(265, 9);
  });

  it('cold start (no seed) anchors the first synthetic tick to the underlying', async () => {
    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2026-01-05', 100) },
      { asset: SPY, bar: bar('2026-01-06', 105) },
    ];
    const { feed } = mockFeed(ticks);
    const wrapped = withStreamingSynthetics(feed, [SPY3X], { seedLastCloses: new Map() });
    const out = await collect(wrapped.subscribe([SPY_3X_ASSET]));
    expect(out[0]!.bar.close).toBe(100);
    // Second tick now has prev = 100 underlying & synth; 5% × 3 = 15% → 115.
    expect(out[1]!.bar.close).toBeCloseTo(115, 9);
  });

  it('applies expense drag per tick', async () => {
    const ticks: StreamingBar[] = [
      { asset: SPY, bar: bar('2026-01-05', 100) },
      { asset: SPY, bar: bar('2026-01-06', 100) },
    ];
    const { feed } = mockFeed(ticks);
    const dragged: SyntheticAsset = {
      id: 'us:DRAG',
      symbol: 'DRAG',
      underlying: SPY_REF,
      leverage: 1,
      expense: 0.252,
    };
    const wrapped = withStreamingSynthetics(feed, [dragged], {
      seedLastCloses: new Map([
        ['us:SPY', 100],
        ['us:DRAG', 100],
      ]),
    });
    const out = await collect(wrapped.subscribe([{ kind: 'equity', id: 'us:DRAG', symbol: 'DRAG' }]));
    // drag = 0.252 / 252 = 0.001 per tick. Flat underlying → close = 100 × (1 - 0.001) each tick.
    expect(out[0]!.bar.close).toBeCloseTo(100 * (1 - 0.001), 9);
    expect(out[1]!.bar.close).toBeCloseTo(100 * Math.pow(1 - 0.001, 2), 9);
  });

  it('yields both raw and synthesized ticks when caller subscribed to the underlying too', async () => {
    const ticks: StreamingBar[] = [{ asset: SPY, bar: bar('2026-01-06', 102) }];
    const { feed } = mockFeed(ticks);
    const wrapped = withStreamingSynthetics(feed, [SPY3X], {
      seedLastCloses: new Map([
        ['us:SPY', 100],
        ['us:SPY_3X', 100],
      ]),
    });
    const out = await collect(wrapped.subscribe([SPY, SPY_3X_ASSET]));
    const ids = out.map((t) => t.asset.id);
    expect(ids).toEqual(['us:SPY', 'us:SPY_3X']);
  });

  it('does not yield raw underlying ticks the caller did not subscribe to', async () => {
    const ticks: StreamingBar[] = [{ asset: SPY, bar: bar('2026-01-06', 102) }];
    const { feed } = mockFeed(ticks);
    const wrapped = withStreamingSynthetics(feed, [SPY3X], {
      seedLastCloses: new Map([
        ['us:SPY', 100],
        ['us:SPY_3X', 100],
      ]),
    });
    const out = await collect(wrapped.subscribe([SPY_3X_ASSET]));
    expect(out.map((t) => t.asset.id)).toEqual(['us:SPY_3X']);
  });

  it('throws on duplicate synthetic ids', () => {
    const a: SyntheticAsset = { id: 'us:X', symbol: 'X', underlying: SPY_REF, leverage: 2 };
    const b: SyntheticAsset = { id: 'us:X', symbol: 'X', underlying: SPY_REF, leverage: 3 };
    const { feed } = mockFeed([]);
    expect(() => withStreamingSynthetics(feed, [a, b], { seedLastCloses: new Map() })).toThrow(
      /duplicate synthetic asset id "us:X"/,
    );
  });

  it('shares one upstream underlying subscription across multiple synthetics', async () => {
    const a: SyntheticAsset = { id: 'us:SPY_2X', symbol: 'SPY_2X', underlying: SPY_REF, leverage: 2 };
    const b: SyntheticAsset = { id: 'us:SPY_INV', symbol: 'SPY_INV', underlying: SPY_REF, leverage: -1 };
    const ticks: StreamingBar[] = [{ asset: SPY, bar: bar('2026-01-06', 105) }];
    const { feed, subscribe } = mockFeed(ticks);
    const wrapped = withStreamingSynthetics(feed, [a, b], {
      seedLastCloses: new Map([
        ['us:SPY', 100],
        ['us:SPY_2X', 100],
        ['us:SPY_INV', 100],
      ]),
    });
    const out = await collect(
      wrapped.subscribe([
        { kind: 'equity', id: 'us:SPY_2X', symbol: 'SPY_2X' },
        { kind: 'equity', id: 'us:SPY_INV', symbol: 'SPY_INV' },
      ]),
    );
    expect((subscribe.mock.calls[0]![0] as ReadonlyArray<Asset>).map((a) => a.id)).toEqual(['us:SPY']);
    const byId = new Map(out.map((t) => [t.asset.id, t.bar.close]));
    expect(byId.get('us:SPY_2X')).toBeCloseTo(110, 9); // 2× 5% = 10%
    expect(byId.get('us:SPY_INV')).toBeCloseTo(95, 9); // -1× 5% = -5%
  });
});
