import { describe, it, expect } from 'vitest';
import { INDICATOR_SYMBOL_MAP, extractSymbols } from './symbols';
import type { Indicator, Strategy, Signal } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPY_TICKER = { symbol: 'SPY', leverage: 1 };

function makeIndicator(overrides: Partial<Indicator> = {}): Indicator {
  return {
    type: 'SMA',
    ticker: SPY_TICKER,
    lookback: 5,
    delay: 0,
    unit: null,
    threshold: null,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    left: makeIndicator({ type: 'Price', lookback: 1 }),
    comparison: '>',
    right: makeIndicator({ type: 'SMA', lookback: 50 }),
    tolerance: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// INDICATOR_SYMBOL_MAP
// ---------------------------------------------------------------------------

describe('INDICATOR_SYMBOL_MAP', () => {
  it('maps VIX to ^VIX', () => {
    expect(INDICATOR_SYMBOL_MAP['VIX']).toBe('^VIX');
  });

  it('maps VIX3M to ^VIX3M', () => {
    expect(INDICATOR_SYMBOL_MAP['VIX3M']).toBe('^VIX3M');
  });

  it('maps all treasury yields to FRED symbols', () => {
    expect(INDICATOR_SYMBOL_MAP['T3M']).toBe('DGS3MO');
    expect(INDICATOR_SYMBOL_MAP['T6M']).toBe('DGS6MO');
    expect(INDICATOR_SYMBOL_MAP['T1Y']).toBe('DGS1');
    expect(INDICATOR_SYMBOL_MAP['T2Y']).toBe('DGS2');
    expect(INDICATOR_SYMBOL_MAP['T3Y']).toBe('DGS3');
    expect(INDICATOR_SYMBOL_MAP['T5Y']).toBe('DGS5');
    expect(INDICATOR_SYMBOL_MAP['T7Y']).toBe('DGS7');
    expect(INDICATOR_SYMBOL_MAP['T10Y']).toBe('DGS10');
    expect(INDICATOR_SYMBOL_MAP['T20Y']).toBe('DGS20');
    expect(INDICATOR_SYMBOL_MAP['T30Y']).toBe('DGS30');
  });

  it('does not map non-data indicators', () => {
    expect(INDICATOR_SYMBOL_MAP['SMA']).toBeUndefined();
    expect(INDICATOR_SYMBOL_MAP['EMA']).toBeUndefined();
    expect(INDICATOR_SYMBOL_MAP['Price']).toBeUndefined();
    expect(INDICATOR_SYMBOL_MAP['Threshold']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extractSymbols
// ---------------------------------------------------------------------------

describe('extractSymbols', () => {
  it('extracts ticker symbols from named signal indicators', () => {
    const strategy: Strategy = {
      linkId: 'test',
      name: 'Test',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [
        { name: 'S1', signal: makeSignal() }, // SPY on both sides
      ],
      allocations: [],
    };

    const symbols = extractSymbols(strategy);
    expect(symbols).toContain('SPY');
  });

  it('maps VIX/yield types to their market symbols', () => {
    const strategy: Strategy = {
      linkId: 'test',
      name: 'Test',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [
        {
          name: 'VIX check',
          signal: makeSignal({
            left: makeIndicator({ type: 'VIX' }),
            right: makeIndicator({ type: 'Threshold', threshold: 20 }),
          }),
        },
        {
          name: 'T10Y check',
          signal: makeSignal({
            left: makeIndicator({ type: 'T10Y' }),
            right: makeIndicator({ type: 'T2Y' }),
          }),
        },
      ],
      allocations: [],
    };

    const symbols = extractSymbols(strategy);
    expect(symbols).toContain('^VIX');
    expect(symbols).toContain('DGS10');
    expect(symbols).toContain('DGS2');
  });

  it('excludes Threshold indicators (no ticker needed)', () => {
    const strategy: Strategy = {
      linkId: 'test',
      name: 'Test',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [
        {
          name: 'Threshold signal',
          signal: makeSignal({
            left: makeIndicator({ type: 'Price', lookback: 1 }),
            right: makeIndicator({ type: 'Threshold', threshold: 100 }),
          }),
        },
      ],
      allocations: [],
    };

    const symbols = extractSymbols(strategy);
    expect(symbols).toContain('SPY');
    // Threshold's ticker (SPY from default) should NOT be included because addIndicatorSymbol skips Threshold
    expect(symbols).toHaveLength(1);
  });

  it('extracts holding symbols from named allocations', () => {
    const strategy: Strategy = {
      linkId: 'test',
      name: 'Test',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [],
      allocations: [
        {
          name: 'A1',
          position: 0,
          allocation: {
            condition: { kind: 'signal', signal: makeSignal() },
            holdings: [
              { ticker: { symbol: 'QQQ', leverage: 1 }, weight: 60 },
              { ticker: { symbol: 'TLT', leverage: 1 }, weight: 40 },
            ],
          },
        },
      ],
    };

    const symbols = extractSymbols(strategy);
    expect(symbols).toContain('QQQ');
    expect(symbols).toContain('TLT');
  });

  it('deduplicates symbols across signals and holdings', () => {
    const strategy: Strategy = {
      linkId: 'test',
      name: 'Test',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [
        { name: 'S1', signal: makeSignal() }, // SPY
      ],
      allocations: [
        {
          name: 'A1',
          position: 0,
          allocation: {
            condition: { kind: 'signal', signal: makeSignal() },
            holdings: [
              { ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }, // duplicate
            ],
          },
        },
      ],
    };

    const symbols = extractSymbols(strategy);
    const spyCount = symbols.filter((s) => s === 'SPY').length;
    expect(spyCount).toBe(1);
  });

  it('returns empty array for strategy with no signals or holdings', () => {
    const strategy: Strategy = {
      linkId: 'test',
      name: 'Test',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [],
      allocations: [],
    };

    expect(extractSymbols(strategy)).toEqual([]);
  });
});
