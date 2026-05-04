import { describe, it, expect } from 'vitest';
import { collectBars, barsToSeries, seriesAt } from './series-utils';
import type { Bar } from '../interfaces/types';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

const sampleBars: Bar[] = [
  { t: utc('2026-01-05'), open: 99, high: 102, low: 98, close: 100, volume: 1_000 },
  { t: utc('2026-01-06'), open: 101, high: 103, low: 100, close: 102, volume: 1_100 },
  { t: utc('2026-01-07'), open: 102, high: 105, low: 101, close: 104, volume: 1_200 },
];

describe('collectBars', () => {
  it('drains an async iterable in order', async () => {
    async function* gen() {
      for (const b of sampleBars) yield b;
    }
    const out = await collectBars(gen());
    expect(out).toHaveLength(3);
    expect(out[0]!.close).toBe(100);
    expect(out[2]!.close).toBe(104);
  });

  it('returns empty for an empty iterable', async () => {
    async function* gen() {}
    expect(await collectBars(gen())).toEqual([]);
  });
});

describe('barsToSeries', () => {
  it('defaults to close', () => {
    const s = barsToSeries(sampleBars);
    expect(s).toHaveLength(3);
    expect(s[0]!.v).toBe(100);
    expect(s[2]!.v).toBe(104);
  });

  it('projects open / high / low / volume on request', () => {
    expect(barsToSeries(sampleBars, 'open')[0]!.v).toBe(99);
    expect(barsToSeries(sampleBars, 'high')[1]!.v).toBe(103);
    expect(barsToSeries(sampleBars, 'low')[2]!.v).toBe(101);
    expect(barsToSeries(sampleBars, 'volume')[0]!.v).toBe(1_000);
  });
});

describe('seriesAt', () => {
  const series = barsToSeries(sampleBars);

  it('returns undefined when t precedes all points', () => {
    expect(seriesAt(series, utc('2026-01-04'))).toBeUndefined();
  });

  it('returns the matching value on exact match', () => {
    expect(seriesAt(series, utc('2026-01-06'))).toBe(102);
  });

  it('returns the latest at-or-before value when t is between points', () => {
    expect(seriesAt(series, new Date('2026-01-06T12:00:00Z'))).toBe(102);
  });

  it('returns the last value when t is after all points', () => {
    expect(seriesAt(series, utc('2026-02-01'))).toBe(104);
  });

  it('returns undefined for an empty series', () => {
    expect(seriesAt([], utc('2026-01-01'))).toBeUndefined();
  });
});
