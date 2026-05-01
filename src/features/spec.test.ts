import { describe, it, expect } from 'vitest';
import { paramsHash, defineFeature, getFeatureCompute, type FeatureSpec } from './spec';
import { sma } from './indicators/sma';
import type { Series } from '../interfaces/types';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const series: Series = [
  { t: utc('2026-01-05'), v: 1 },
  { t: utc('2026-01-06'), v: 2 },
  { t: utc('2026-01-07'), v: 3 },
  { t: utc('2026-01-08'), v: 4 },
  { t: utc('2026-01-09'), v: 5 },
];

describe('paramsHash', () => {
  it('is deterministic across field order', () => {
    const a: FeatureSpec = { kind: 'sma', period: 20 };
    const b: FeatureSpec = { period: 20, kind: 'sma' } as FeatureSpec;
    expect(paramsHash(a)).toBe(paramsHash(b));
  });

  it('differs when params differ', () => {
    expect(paramsHash({ kind: 'sma', period: 20 })).not.toBe(paramsHash({ kind: 'sma', period: 21 }));
  });

  it('treats missing optional as the absent default', () => {
    const a: FeatureSpec = { kind: 'return', period: 1 };
    const b: FeatureSpec = { kind: 'return', period: 1, mode: undefined as never };
    expect(paramsHash(a)).toBe(paramsHash(b));
  });
});

describe('defineFeature / getFeatureCompute', () => {
  it('built-in sma is registered and produces matching output', () => {
    const fn = getFeatureCompute('sma');
    const expected = sma(series, 3);
    const actual = fn(series, { kind: 'sma', period: 3 });
    expect(actual).toEqual(expected);
  });

  it.each<FeatureSpec['kind']>(['price', 'sma', 'ema', 'rsi', 'return', 'volatility', 'drawdown'])(
    'built-in %s is registered',
    (kind) => {
      expect(() => getFeatureCompute(kind)).not.toThrow();
    },
  );

  it('throws on unknown kind', () => {
    expect(() => getFeatureCompute('not-a-feature' as never)).toThrow(/unknown/);
  });

  it('throws on duplicate registration', () => {
    expect(() => defineFeature('sma', (s) => s)).toThrow(/already registered/);
  });
});
