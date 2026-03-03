import { describe, expect, it, vi } from 'vitest';
import {
  FRED_BROKERABLE_MAP,
  BASE_TICKER_ALIASES,
  LEVERAGED_ETF_MAP,
  mapTickerToBrokerable,
} from './symbols';

describe('FRED_BROKERABLE_MAP', () => {
  it('maps DTB3 to null (cash)', () => {
    expect(FRED_BROKERABLE_MAP['DTB3']).toBeNull();
  });

  it('maps DFF to USFR', () => {
    expect(FRED_BROKERABLE_MAP['DFF']).toBe('USFR');
  });
});

describe('BASE_TICKER_ALIASES', () => {
  it('maps VOO to SPY', () => {
    expect(BASE_TICKER_ALIASES['VOO']).toBe('SPY');
  });

  it('maps IVV to SPY', () => {
    expect(BASE_TICKER_ALIASES['IVV']).toBe('SPY');
  });
});

describe('LEVERAGED_ETF_MAP', () => {
  it('contains expected leverage mappings', () => {
    expect(LEVERAGED_ETF_MAP['SPY:2']).toBe('SSO');
    expect(LEVERAGED_ETF_MAP['SPY:3']).toBe('UPRO');
    expect(LEVERAGED_ETF_MAP['QQQ:2']).toBe('QLD');
    expect(LEVERAGED_ETF_MAP['QQQ:3']).toBe('TQQQ');
  });
});

describe('mapTickerToBrokerable', () => {
  it('maps QQQ x2 to QLD', () => {
    expect(mapTickerToBrokerable({ symbol: 'QQQ', leverage: 2 })).toBe('QLD');
  });

  it('maps QQQ x3 to TQQQ', () => {
    expect(mapTickerToBrokerable({ symbol: 'QQQ', leverage: 3 })).toBe('TQQQ');
  });

  it('maps SPY x2 to SSO', () => {
    expect(mapTickerToBrokerable({ symbol: 'SPY', leverage: 2 })).toBe('SSO');
  });

  it('maps SPY x3 to UPRO', () => {
    expect(mapTickerToBrokerable({ symbol: 'SPY', leverage: 3 })).toBe('UPRO');
  });

  it('maps VOO x2 to SSO via alias', () => {
    expect(mapTickerToBrokerable({ symbol: 'VOO', leverage: 2 })).toBe('SSO');
  });

  it('maps IVV x3 to UPRO via alias', () => {
    expect(mapTickerToBrokerable({ symbol: 'IVV', leverage: 3 })).toBe('UPRO');
  });

  it('maps TLT x2 to UBT', () => {
    expect(mapTickerToBrokerable({ symbol: 'TLT', leverage: 2 })).toBe('UBT');
  });

  it('maps GLD x2 to UGL', () => {
    expect(mapTickerToBrokerable({ symbol: 'GLD', leverage: 2 })).toBe('UGL');
  });

  it('warns and passes through for unmapped leverage', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = mapTickerToBrokerable({ symbol: 'XLF', leverage: 2 });
    expect(result).toBe('XLF');
    expect(warnSpy).toHaveBeenCalledWith('No leveraged ETF mapping for XLF at 2x — passing through as XLF');
    warnSpy.mockRestore();
  });

  it('passes through symbol unchanged at leverage 1', () => {
    expect(mapTickerToBrokerable({ symbol: 'QQQ', leverage: 1 })).toBe('QQQ');
  });

  it('FRED mapping takes priority over leverage', () => {
    expect(mapTickerToBrokerable({ symbol: 'DFF', leverage: 2 })).toBe('USFR');
    expect(mapTickerToBrokerable({ symbol: 'DTB3', leverage: 3 })).toBeNull();
  });
});
