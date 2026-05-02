import { describe, it, expect, vi } from 'vitest';
import { withSynthetics } from './synthetics';
import type { DataFeed } from '../interfaces/data-feed';
import type { Asset, Bar } from '../interfaces/types';
import type { SyntheticAsset } from './types';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const SPY_REF = { id: 'us:SPY', symbol: 'SPY' };
const SPY3X: SyntheticAsset = { id: 'us:SPY_3X', symbol: 'SPY_3X', underlying: SPY_REF, leverage: 3 };

const range = { from: utc('2026-01-05'), to: utc('2026-01-15') };

function feed(map: Record<string, Bar[]>) {
  const calls = vi.fn(async function* (asset: Asset, _r, _f) {
    for (const b of map[asset.id] ?? []) yield b;
  });
  return { feed: { bars: calls } as DataFeed, calls };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

const underlyingBars: Bar[] = [100, 105, 100, 102].map((c, i) => ({
  t: utc(`2026-01-0${5 + i}`),
  open: c,
  high: c,
  low: c,
  close: c,
  volume: 10 + i,
}));

describe('withSynthetics', () => {
  it('passes through non-synthetic asset bars unchanged', async () => {
    const { feed: f, calls } = feed({
      'us:AGG': [{ t: utc('2026-01-05'), open: 50, high: 50, low: 50, close: 50, volume: 1 }],
    });
    const wrapped = withSynthetics(f, [SPY3X]);
    const out = await collect(wrapped.bars({ kind: 'equity', id: 'us:AGG', symbol: 'AGG' }, range, '1d'));
    expect(calls).toHaveBeenCalledTimes(1);
    expect(out).toHaveLength(1);
    expect(out[0]!.close).toBe(50);
  });

  it('anchors the first synthetic bar to the underlying close', async () => {
    const { feed: f } = feed({ 'us:SPY': underlyingBars });
    const wrapped = withSynthetics(f, [SPY3X]);
    const out = await collect(wrapped.bars({ kind: 'equity', id: 'us:SPY_3X', symbol: 'SPY_3X' }, range, '1d'));
    expect(out[0]!.close).toBe(100);
  });

  it('with leverage = 1 reproduces the underlying close exactly', async () => {
    const { feed: f } = feed({ 'us:SPY': underlyingBars });
    const lev1: SyntheticAsset = { id: 'us:SPY_1X', symbol: 'SPY_1X', underlying: SPY_REF, leverage: 1 };
    const wrapped = withSynthetics(f, [lev1]);
    const out = await collect(wrapped.bars({ kind: 'equity', id: 'us:SPY_1X', symbol: 'SPY_1X' }, range, '1d'));
    expect(out.map((b) => b.close)).toEqual(underlyingBars.map((b) => b.close));
  });

  it('with leverage = 2 doubles each daily return', async () => {
    const { feed: f } = feed({ 'us:SPY': underlyingBars });
    const lev2: SyntheticAsset = { id: 'us:SPY_2X', symbol: 'SPY_2X', underlying: SPY_REF, leverage: 2 };
    const wrapped = withSynthetics(f, [lev2]);
    const out = await collect(wrapped.bars({ kind: 'equity', id: 'us:SPY_2X', symbol: 'SPY_2X' }, range, '1d'));
    expect(out[1]!.close).toBeCloseTo(110, 9);
    expect(out[2]!.close).toBeCloseTo(110 * (1 + 2 * (-5 / 105)), 9);
  });

  it('with leverage = -1 negates each daily return', async () => {
    const { feed: f } = feed({ 'us:SPY': underlyingBars });
    const inv: SyntheticAsset = { id: 'us:SPY_INV', symbol: 'SPY_INV', underlying: SPY_REF, leverage: -1 };
    const wrapped = withSynthetics(f, [inv]);
    const out = await collect(wrapped.bars({ kind: 'equity', id: 'us:SPY_INV', symbol: 'SPY_INV' }, range, '1d'));
    expect(out[1]!.close).toBeCloseTo(95, 9);
  });

  it('shows volatility decay on a 3x oscillating series', async () => {
    const oscBars: Bar[] = [100, 105, 99.75, 104.7375, 99.5006].map((c, i) => ({
      t: utc(`2026-01-0${5 + i}`),
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 1,
    }));
    const { feed: f } = feed({ 'us:SPY': oscBars });
    const wrapped = withSynthetics(f, [SPY3X]);
    const out = await collect(wrapped.bars({ kind: 'equity', id: 'us:SPY_3X', symbol: 'SPY_3X' }, range, '1d'));
    expect(out[out.length - 1]!.close).toBeLessThan(100);
  });

  it('treats a zero / non-finite previous close as a 0 daily return', async () => {
    const oddBars: Bar[] = [
      { t: utc('2026-01-05'), open: 100, high: 100, low: 100, close: 100, volume: 1 },
      { t: utc('2026-01-06'), open: 0, high: 0, low: 0, close: 0, volume: 1 },
      { t: utc('2026-01-07'), open: 50, high: 50, low: 50, close: 50, volume: 1 },
    ];
    const { feed: f } = feed({ 'us:SPY': oddBars });
    const wrapped = withSynthetics(f, [SPY3X]);
    const out = await collect(wrapped.bars({ kind: 'equity', id: 'us:SPY_3X', symbol: 'SPY_3X' }, range, '1d'));
    expect(out[1]!.close).toBeCloseTo(-200, 9);
    expect(out[2]!.close).toBeCloseTo(-200, 9);
  });

  it('expense undefined matches the no-drag baseline', async () => {
    const flat: Bar[] = [100, 100, 100, 100].map((c, i) => ({
      t: utc(`2026-01-0${5 + i}`),
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 1,
    }));
    const baseline = { id: 'us:SPY_BL', symbol: 'BL', underlying: SPY_REF, leverage: 1 } as const;
    const { feed: f } = feed({ 'us:SPY': flat });
    const wrapped = withSynthetics(f, [baseline]);
    const out = await collect(wrapped.bars({ kind: 'equity', id: 'us:SPY_BL', symbol: 'BL' }, range, '1d'));
    expect(out.map((b) => b.close)).toEqual([100, 100, 100, 100]);
  });

  it('expense > 0 applies a daily multiplicative drag', async () => {
    const flat: Bar[] = [100, 100, 100, 100].map((c, i) => ({
      t: utc(`2026-01-0${5 + i}`),
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 1,
    }));
    const dragged: SyntheticAsset = { id: 'us:DRAG', symbol: 'DRAG', underlying: SPY_REF, leverage: 1, expense: 0.252 };
    const { feed: f } = feed({ 'us:SPY': flat });
    const wrapped = withSynthetics(f, [dragged]);
    const out = await collect(wrapped.bars({ kind: 'equity', id: 'us:DRAG', symbol: 'DRAG' }, range, '1d'));
    expect(out[0]!.close).toBe(100);
    expect(out[3]!.close).toBeCloseTo(100 * Math.pow(1 - 0.001, 3), 9);
  });

  it('throws on duplicate synthetic ids', () => {
    const a: SyntheticAsset = { id: 'us:X', symbol: 'X', underlying: SPY_REF, leverage: 2 };
    const b: SyntheticAsset = { id: 'us:X', symbol: 'X', underlying: SPY_REF, leverage: 3 };
    const { feed: f } = feed({});
    expect(() => withSynthetics(f, [a, b])).toThrow(/duplicate synthetic asset id "us:X"/);
  });

  it('does not delegate to the wrapped feed on synthetic id queries', async () => {
    const { feed: f, calls } = feed({ 'us:SPY': underlyingBars });
    const wrapped = withSynthetics(f, [SPY3X]);
    await collect(wrapped.bars({ kind: 'equity', id: 'us:SPY_3X', symbol: 'SPY_3X' }, range, '1d'));
    const askedFor = calls.mock.calls.map((c) => (c[0] as Asset).id);
    expect(askedFor).toContain('us:SPY');
    expect(askedFor).not.toContain('us:SPY_3X');
  });
});
