import { describe, it, expect } from 'vitest';
import { MemoryFeatureCache } from './memory-feature-cache';
import type { FeatureKey } from '../interfaces/feature-cache';

const range = { from: new Date('2026-01-01T00:00:00Z'), to: new Date('2026-02-01T00:00:00Z') };
const key = (feature: string, asset: string, paramsHash: string): FeatureKey => ({
  feature,
  paramsHash,
  scope: { kind: 'asset', asset },
  range,
  freq: '1d',
});

describe('MemoryFeatureCache', () => {
  it('returns undefined on miss', async () => {
    const cache = new MemoryFeatureCache();
    expect(await cache.get(key('sma', 'us:SPY', 'p1'))).toBeUndefined();
  });

  it('round-trips a series', async () => {
    const cache = new MemoryFeatureCache();
    const series = [{ t: new Date('2026-01-02T00:00:00Z'), v: 400 }];
    await cache.set(key('sma', 'us:SPY', 'p1'), series);
    expect(await cache.get(key('sma', 'us:SPY', 'p1'))).toEqual(series);
  });

  it('treats keys as equal regardless of property order', async () => {
    const cache = new MemoryFeatureCache();
    const k1: FeatureKey = {
      feature: 'sma',
      paramsHash: 'p1',
      scope: { kind: 'asset', asset: 'us:SPY' },
      range,
      freq: '1d',
    };
    const k2: FeatureKey = {
      freq: '1d',
      range,
      scope: { kind: 'asset', asset: 'us:SPY' },
      paramsHash: 'p1',
      feature: 'sma',
    };
    await cache.set(k1, [{ t: new Date('2026-01-02T00:00:00Z'), v: 1 }]);
    expect(await cache.get(k2)).toBeDefined();
  });

  it('invalidate by feature prefix removes only matching entries', async () => {
    const cache = new MemoryFeatureCache();
    await cache.set(key('sma', 'us:SPY', 'p1'), [{ t: new Date(), v: 1 }]);
    await cache.set(key('rsi', 'us:SPY', 'p1'), [{ t: new Date(), v: 2 }]);
    await cache.invalidate?.({ feature: 'sma' });
    expect(await cache.get(key('sma', 'us:SPY', 'p1'))).toBeUndefined();
    expect(await cache.get(key('rsi', 'us:SPY', 'p1'))).toBeDefined();
  });
});
