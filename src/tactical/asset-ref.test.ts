import { describe, it, expect } from 'vitest';
import { resolveAssetRef } from './asset-ref';

describe('resolveAssetRef', () => {
  it('produces a MacroAsset when ref.kind === "macro"', () => {
    const out = resolveAssetRef({ kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' });
    expect(out).toEqual({ kind: 'macro', id: 'DGS10', symbol: '10Y Treasury' });
  });

  it('produces an EquityAsset with exchange when ref.exchange is defined', () => {
    const out = resolveAssetRef({ id: 'AAPL', symbol: 'AAPL', exchange: 'NASDAQ' });
    expect(out).toEqual({ kind: 'equity', id: 'AAPL', symbol: 'AAPL', exchange: 'NASDAQ' });
  });

  it('produces an EquityAsset without exchange when ref.exchange is undefined', () => {
    const out = resolveAssetRef({ id: 'AAPL', symbol: 'AAPL' });
    expect(out).toEqual({ kind: 'equity', id: 'AAPL', symbol: 'AAPL' });
    expect('exchange' in out).toBe(false);
  });

  it('treats explicit kind: "equity" the same as the default', () => {
    const explicit = resolveAssetRef({ kind: 'equity', id: 'SPY', symbol: 'SPY' });
    const implicit = resolveAssetRef({ id: 'SPY', symbol: 'SPY' });
    expect(explicit).toEqual(implicit);
  });

  it('drops exchange when kind is macro (macro assets do not carry an exchange)', () => {
    const out = resolveAssetRef({ kind: 'macro', id: 'DGS10', symbol: '10Y', exchange: 'IGNORED' });
    expect(out).toEqual({ kind: 'macro', id: 'DGS10', symbol: '10Y' });
    expect('exchange' in out).toBe(false);
  });
});
