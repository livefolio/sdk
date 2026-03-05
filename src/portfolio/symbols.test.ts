import { describe, expect, it } from 'vitest';
import {
  FRED_BROKERABLE_MAP,
  BASE_TICKER_ALIASES,
  ETF_LEVERAGE_MAP,
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

describe('ETF_LEVERAGE_MAP', () => {
  it('contains expected bull leverage mappings', () => {
    expect(ETF_LEVERAGE_MAP['SPY:2']).toBe('SSO');
    expect(ETF_LEVERAGE_MAP['SPY:3']).toBe('UPRO');
    expect(ETF_LEVERAGE_MAP['QQQ:2']).toBe('QLD');
    expect(ETF_LEVERAGE_MAP['QQQ:3']).toBe('TQQQ');
    expect(ETF_LEVERAGE_MAP['XLF:3']).toBe('FAS');
    expect(ETF_LEVERAGE_MAP['SOXX:3']).toBe('SOXL');
    expect(ETF_LEVERAGE_MAP['BTC-USD:2']).toBe('BITU');
  });

  it('contains expected inverse mappings', () => {
    expect(ETF_LEVERAGE_MAP['SPY:-1']).toBe('SH');
    expect(ETF_LEVERAGE_MAP['QQQ:-3']).toBe('SQQQ');
    expect(ETF_LEVERAGE_MAP['TLT:-3']).toBe('TMV');
    expect(ETF_LEVERAGE_MAP['GLD:-2']).toBe('GLL');
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

  it('maps XLF x3 to FAS', () => {
    expect(mapTickerToBrokerable({ symbol: 'XLF', leverage: 3 })).toBe('FAS');
  });

  it('maps SOXX x3 to SOXL', () => {
    expect(mapTickerToBrokerable({ symbol: 'SOXX', leverage: 3 })).toBe('SOXL');
  });

  it('maps BTC-USD x2 to BITU', () => {
    expect(mapTickerToBrokerable({ symbol: 'BTC-USD', leverage: 2 })).toBe('BITU');
  });

  it('maps QQQ x-3 to SQQQ', () => {
    expect(mapTickerToBrokerable({ symbol: 'QQQ', leverage: -3 })).toBe('SQQQ');
  });

  it('maps SPY x-1 to SH', () => {
    expect(mapTickerToBrokerable({ symbol: 'SPY', leverage: -1 })).toBe('SH');
  });

  it('maps TLT x-3 to TMV', () => {
    expect(mapTickerToBrokerable({ symbol: 'TLT', leverage: -3 })).toBe('TMV');
  });

  it('throws for unmapped bull leverage', () => {
    expect(() => mapTickerToBrokerable({ symbol: 'ARKK', leverage: 2 }))
      .toThrow('No leveraged ETF mapping for ARKK at 2x');
  });

  it('throws for unmapped inverse leverage', () => {
    expect(() => mapTickerToBrokerable({ symbol: 'ARKK', leverage: -1 }))
      .toThrow('No leveraged ETF mapping for ARKK at -1x');
  });

  it('passes through symbol unchanged at leverage 1', () => {
    expect(mapTickerToBrokerable({ symbol: 'QQQ', leverage: 1 })).toBe('QQQ');
  });

  it('FRED mapping takes priority over leverage', () => {
    expect(mapTickerToBrokerable({ symbol: 'DFF', leverage: 2 })).toBe('USFR');
    expect(mapTickerToBrokerable({ symbol: 'DTB3', leverage: 3 })).toBeNull();
  });
});
