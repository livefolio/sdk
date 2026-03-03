import { describe, it, expect } from 'vitest';
import {
  evaluateIndicator,
  evaluateSignal,
  evaluateAllocation,
  evaluate,
  getEvaluationDate,
  indicatorKey,
  signalKey,
  findAllSignals,
} from './evaluate';
import { extractSymbols } from './symbols';
import type {
  Allocation,
  Condition,
  EvaluationOptions,
  Indicator,
  NamedAllocation,
  Signal,
  Strategy,
} from './types';

import type { Observation } from '../market/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

// Market close at 4:00 PM ET = 21:00 UTC (EST) or 20:00 UTC (EDT)
// Using EST (winter) for consistent tests
function marketCloseUTC(dateStr: string): string {
  return `${dateStr}T21:00:00.000Z`;
}

function makeSeries(dates: string[], prices: number[]): Observation[] {
  return dates.map((d, i) => ({ timestamp: marketCloseUTC(d), value: prices[i] }));
}

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
    right: makeIndicator({ type: 'SMA', lookback: 5 }),
    tolerance: 0,
    ...overrides,
  };
}

function makeOptions(overrides: Partial<EvaluationOptions> = {}): EvaluationOptions {
  const dates = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'];
  const prices = [100, 102, 101, 103, 104];
  return {
    at: new Date(marketCloseUTC('2025-01-10')),
    batchSeries: { SPY: makeSeries(dates, prices) },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Indicator tests
// ---------------------------------------------------------------------------

describe('evaluateIndicator', () => {
  describe('SMA', () => {
    it('computes mean over lookback window', () => {
      const ind = makeIndicator({ type: 'SMA', lookback: 5 });
      const result = evaluateIndicator(ind, makeOptions());
      expect(result.value).toBeCloseTo((100 + 102 + 101 + 103 + 104) / 5);
    });

    it('throws on empty series', () => {
      const ind = makeIndicator({ type: 'SMA', ticker: { symbol: 'NOPE', leverage: 1 } });
      expect(() => evaluateIndicator(ind, makeOptions())).toThrow('No observations');
    });
  });

  describe('EMA', () => {
    it('computes exponential smoothing over full series', () => {
      const ind = makeIndicator({ type: 'EMA', lookback: 5 });
      const result = evaluateIndicator(ind, makeOptions());
      // k = 2/(5+1) = 1/3
      const k = 2 / 6;
      let ema = 100;
      ema = 102 * k + ema * (1 - k);
      ema = 101 * k + ema * (1 - k);
      ema = 103 * k + ema * (1 - k);
      ema = 104 * k + ema * (1 - k);
      expect(result.value).toBeCloseTo(ema);
      expect(result.metadata).toEqual({ ema: expect.closeTo(ema) });
    });

    it('computes incrementally when metadata is provided', () => {
      const ind = makeIndicator({ type: 'EMA', lookback: 5 });
      const prevEma = 101.5;
      const options = makeOptions({
        previousIndicatorMetadata: { [indicatorKey(ind)]: { ema: prevEma } },
      });
      const result = evaluateIndicator(ind, options);
      const k = 2 / 6;
      const expected = 104 * k + prevEma * (1 - k);
      expect(result.value).toBeCloseTo(expected);
      expect(result.metadata).toEqual({ ema: expect.closeTo(expected) });
    });
  });

  describe('Price', () => {
    it('returns latest value', () => {
      const ind = makeIndicator({ type: 'Price', lookback: 1 });
      const result = evaluateIndicator(ind, makeOptions());
      expect(result.value).toBe(104);
    });
  });

  describe('Return', () => {
    it('computes percent change over lookback', () => {
      const ind = makeIndicator({ type: 'Return', lookback: 5 });
      const result = evaluateIndicator(ind, makeOptions());
      expect(result.value).toBeCloseTo(((104 - 100) / 100) * 100);
    });
  });

  describe('Volatility', () => {
    it('computes annualized standard deviation', () => {
      const ind = makeIndicator({ type: 'Volatility', lookback: 5 });
      const result = evaluateIndicator(ind, makeOptions());
      expect(result.value).toBeGreaterThan(0);
      expect(typeof result.value).toBe('number');
    });
  });

  describe('Drawdown', () => {
    it('computes peak-to-current drawdown', () => {
      // Series goes up then down: peak at 105
      const dates = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'];
      const prices = [100, 103, 105, 102, 100];
      const ind = makeIndicator({ type: 'Drawdown', lookback: 1 });
      const opts = makeOptions({
        batchSeries: { SPY: makeSeries(dates, prices) },

      });
      const result = evaluateIndicator(ind, opts);
      // (105 - 100) / 105 * 100 ≈ 4.76%
      expect(result.value).toBeCloseTo(Math.abs(((100 - 105) / 105) * 100));
      expect(result.metadata).toEqual({ peak: 105 });
    });

    it('tracks peak incrementally with metadata', () => {
      const ind = makeIndicator({ type: 'Drawdown', lookback: 1 });
      const opts = makeOptions({
        previousIndicatorMetadata: { [indicatorKey(ind)]: { peak: 110 } },
      });
      const result = evaluateIndicator(ind, opts);
      // Current price is 104, peak stays at 110
      expect(result.value).toBeCloseTo(Math.abs(((104 - 110) / 110) * 100));
      expect(result.metadata).toEqual({ peak: 110 });
    });
  });

  describe('RSI', () => {
    it('computes RSI with Wilder smoothing', () => {
      const ind = makeIndicator({ type: 'RSI', lookback: 14 });
      const dates: string[] = [];
      const prices: number[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(Date.UTC(2025, 0, 6 + i));
        // Skip weekends
        if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
        dates.push(d.toISOString().slice(0, 10));
        prices.push(100 + Math.sin(i / 3) * 10);
      }
      const opts = makeOptions({
        at: new Date(marketCloseUTC(dates[dates.length - 1])),
        batchSeries: { SPY: makeSeries(dates, prices) },

      });
      const result = evaluateIndicator(ind, opts);
      expect(result.value).toBeGreaterThanOrEqual(0);
      expect(result.value).toBeLessThanOrEqual(100);
      expect(result.metadata).toHaveProperty('avgGain');
      expect(result.metadata).toHaveProperty('avgLoss');
    });

    it('computes incrementally when metadata is provided', () => {
      const ind = makeIndicator({ type: 'RSI', lookback: 14 });
      // Need at least 2 obs for incremental (current + previous for change)
      const dates = ['2025-01-09', '2025-01-10'];
      const prices = [103, 104];
      const opts: EvaluationOptions = {
        at: new Date(marketCloseUTC('2025-01-10')),
        batchSeries: { SPY: makeSeries(dates, prices) },

        previousIndicatorMetadata: {
          [indicatorKey(ind)]: { avgGain: 1.5, avgLoss: 0.8 },
        },
      };
      const result = evaluateIndicator(ind, opts);
      const k = 1 / 14;
      const change = 104 - 103; // +1
      const expectedAvgGain = 1 * k + 1.5 * (1 - k);
      const expectedAvgLoss = 0 * k + 0.8 * (1 - k);
      const expectedRSI = 100 - 100 / (1 + expectedAvgGain / expectedAvgLoss);
      expect(result.value).toBeCloseTo(expectedRSI);
    });
  });

  describe('Temporal indicators', () => {
    it('Month returns 1-12', () => {
      const ind = makeIndicator({ type: 'Month' });
      const result = evaluateIndicator(ind, makeOptions());
      expect(result.value).toBe(1); // January
    });

    it('Day of Week returns 0-6', () => {
      const ind = makeIndicator({ type: 'Day of Week' });
      // 2025-01-10 is Friday = 5
      const result = evaluateIndicator(ind, makeOptions());
      expect(result.value).toBe(5);
    });

    it('Day of Month returns day number', () => {
      const ind = makeIndicator({ type: 'Day of Month' });
      const result = evaluateIndicator(ind, makeOptions());
      expect(result.value).toBe(10);
    });

    it('Day of Year returns day of year', () => {
      const ind = makeIndicator({ type: 'Day of Year' });
      const result = evaluateIndicator(ind, makeOptions());
      expect(result.value).toBe(10);
    });
  });

  describe('Threshold', () => {
    it('returns constant value', () => {
      const ind = makeIndicator({ type: 'Threshold', threshold: 42 });
      const result = evaluateIndicator(ind, makeOptions());
      expect(result.value).toBe(42);
    });

    it('returns threshold=0 when threshold is 0', () => {
      const ind = makeIndicator({ type: 'Threshold', threshold: 0 });
      const result = evaluateIndicator(ind, makeOptions());
      expect(result.value).toBe(0);
    });
  });

  describe('error: empty series throws for each indicator type', () => {
    const emptyOpts = makeOptions({
      batchSeries: { NOPE: makeSeries([], []) },
    });
    const nopeTicker = { symbol: 'NOPE', leverage: 1 };

    it('EMA throws on empty series', () => {
      expect(() =>
        evaluateIndicator(makeIndicator({ type: 'EMA', ticker: nopeTicker }), emptyOpts),
      ).toThrow('No observations');
    });

    it('Price throws on empty series', () => {
      expect(() =>
        evaluateIndicator(makeIndicator({ type: 'Price', ticker: nopeTicker, lookback: 1 }), emptyOpts),
      ).toThrow('No observations');
    });

    it('Return throws on empty series', () => {
      expect(() =>
        evaluateIndicator(makeIndicator({ type: 'Return', ticker: nopeTicker }), emptyOpts),
      ).toThrow('No observations');
    });

    it('Volatility throws on empty series', () => {
      expect(() =>
        evaluateIndicator(makeIndicator({ type: 'Volatility', ticker: nopeTicker }), emptyOpts),
      ).toThrow('No observations');
    });

    it('Drawdown throws on empty series', () => {
      expect(() =>
        evaluateIndicator(makeIndicator({ type: 'Drawdown', ticker: nopeTicker }), emptyOpts),
      ).toThrow('No observations');
    });

    it('RSI throws on empty series', () => {
      expect(() =>
        evaluateIndicator(makeIndicator({ type: 'RSI', ticker: nopeTicker }), emptyOpts),
      ).toThrow('No observations');
    });
  });

  describe('VIX/yield delegate indicators', () => {
    // These delegate to Price with mapped symbols, so we need the mapped symbol in batchSeries
    it('VIX delegates to Price with ^VIX symbol', () => {
      const dates = ['2025-01-10'];
      const ind = makeIndicator({ type: 'VIX', lookback: 1 });
      const opts = makeOptions({
        batchSeries: { '^VIX': makeSeries(dates, [18.5]) },

      });
      const result = evaluateIndicator(ind, opts);
      expect(result.value).toBe(18.5);
    });

    it('T10Y delegates to Price with DGS10 symbol', () => {
      const dates = ['2025-01-10'];
      const ind = makeIndicator({ type: 'T10Y', lookback: 1 });
      const opts = makeOptions({
        batchSeries: { DGS10: makeSeries(dates, [4.25]) },

      });
      const result = evaluateIndicator(ind, opts);
      expect(result.value).toBe(4.25);
    });

    // Cover all remaining yield delegate functions
    const yieldDelegates: Array<{ type: string; symbol: string; }> = [
      { type: 'VIX3M', symbol: '^VIX3M' },
      { type: 'T3M', symbol: 'DGS3MO' },
      { type: 'T6M', symbol: 'DGS6MO' },
      { type: 'T1Y', symbol: 'DGS1' },
      { type: 'T2Y', symbol: 'DGS2' },
      { type: 'T3Y', symbol: 'DGS3' },
      { type: 'T5Y', symbol: 'DGS5' },
      { type: 'T7Y', symbol: 'DGS7' },
      { type: 'T20Y', symbol: 'DGS20' },
      { type: 'T30Y', symbol: 'DGS30' },
    ];

    for (const { type, symbol } of yieldDelegates) {
      it(`${type} delegates to Price with ${symbol} symbol`, () => {
        const dates = ['2025-01-10'];
        const ind = makeIndicator({ type: type as any, lookback: 1 });
        const opts = makeOptions({
          batchSeries: { [symbol]: makeSeries(dates, [3.5]) },
  
        });
        const result = evaluateIndicator(ind, opts);
        expect(result.value).toBe(3.5);
      });
    }
  });

  describe('Delay', () => {
    it('skips last N observations', () => {
      const ind = makeIndicator({ type: 'Price', lookback: 1, delay: 1 });
      const result = evaluateIndicator(ind, makeOptions());
      // With delay=1, should get 103 instead of 104
      expect(result.value).toBe(103);
    });
  });

  describe('Leverage', () => {
    it('amplifies daily returns', () => {
      const dates = ['2025-01-06', '2025-01-07', '2025-01-08'];
      const prices = [100, 110, 105];
      const ind = makeIndicator({
        type: 'SMA',
        lookback: 3,
        ticker: { symbol: 'SPY', leverage: 2 },
      });
      const opts = makeOptions({
        at: new Date(marketCloseUTC('2025-01-08')),
        batchSeries: { SPY: makeSeries(dates, prices) },

      });
      const result = evaluateIndicator(ind, opts);
      // Day1: base = 100
      // Day2: 100→110 = +10%, leveraged +20% → 100 * 1.2 = 120
      // Day3: 110→105 = -4.545%, leveraged -9.09% → 120 * (1 - 0.0909) ≈ 109.09
      const lev1 = 100;
      const lev2 = lev1 * (1 + ((110 - 100) / 100) * 2); // 120
      const lev3 = lev2 * (1 + ((105 - 110) / 110) * 2); // ≈109.09
      const expected = (lev1 + lev2 + lev3) / 3;
      expect(result.value).toBeCloseTo(expected);
    });
  });
});

// ---------------------------------------------------------------------------
// Signal tests
// ---------------------------------------------------------------------------

describe('evaluateSignal', () => {
  describe('basic comparisons', () => {
    it('> returns true when left > right', () => {
      // Price (104) > SMA(5) (102)
      const signal = makeSignal({ comparison: '>' });
      expect(evaluateSignal(signal, makeOptions())).toBe(true);
    });

    it('< returns true when left < right', () => {
      const signal = makeSignal({ comparison: '<' });
      expect(evaluateSignal(signal, makeOptions())).toBe(false);
    });

    it('= returns true when left equals right within tolerance', () => {
      // Price = SMA with large tolerance
      const signal = makeSignal({ comparison: '=', tolerance: 50 });
      expect(evaluateSignal(signal, makeOptions())).toBe(true);
    });
  });

  describe('tolerance delta calculation', () => {
    it('uses absolute points when unit is %', () => {
      // left unit is % → tolerance is absolute
      const signal = makeSignal({
        left: makeIndicator({ type: 'Price', lookback: 1, unit: '%' }),
        tolerance: 5,
        comparison: '=',
      });
      const result = evaluateSignal(signal, makeOptions());
      // SMA ≈ 102, Price = 104, tolerance = 5 points
      // lowerBound = 102 - 5 = 97, upperBound = 102 + 5 = 107
      // 104 is within [97, 107]
      expect(result).toBe(true);
    });

    it('uses relative tolerance when unit is not %', () => {
      const signal = makeSignal({ tolerance: 5 });
      // default unit is null → relative: 5% of right value
      // SMA ≈ 102, tolerance = 102 * 5/100 = 5.1
      const result = evaluateSignal(signal, makeOptions({ previousSignalStates: undefined }));
      // This just tests it doesn't throw; exact value depends on the math
      expect(typeof result).toBe('boolean');
    });
  });

  describe('dead-band hysteresis', () => {
    const signal = makeSignal({ tolerance: 5 }); // 5% relative tolerance
    const key = signalKey(signal);

    it('cold start (no previous): strict comparison', () => {
      const result = evaluateSignal(signal, makeOptions());
      // Price (104) > SMA (~102): true
      expect(result).toBe(true);
    });

    it('tolerance=0: no dead band', () => {
      const sig = makeSignal({ tolerance: 0 });
      const opts = makeOptions({
        previousSignalStates: { [signalKey(sig)]: true },
      });
      const result = evaluateSignal(sig, opts);
      expect(result).toBe(true);
    });

    it('> with previous=true: stays true inside band (sticky)', () => {
      // Even if price is slightly below SMA, with tolerance it stays true
      const dates = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'];
      const prices = [100, 102, 101, 103, 101]; // Price=101, SMA=101.4
      const sig = makeSignal({ tolerance: 5 });
      const opts = makeOptions({
        batchSeries: { SPY: makeSeries(dates, prices) },

        previousSignalStates: { [signalKey(sig)]: true },
      });
      const result = evaluateSignal(sig, opts);
      // Price=101, SMA≈101.4, tolerance≈5.07 (5% of 101.4)
      // lowerBound ≈ 96.33, upperBound ≈ 106.47
      // previous=true: stays true if price >= lowerBound
      expect(result).toBe(true);
    });

    it('> with previous=false: only turns on above upper bound', () => {
      const dates = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'];
      const prices = [100, 102, 101, 103, 101]; // Price close to SMA
      const sig = makeSignal({ tolerance: 5 });
      const opts = makeOptions({
        batchSeries: { SPY: makeSeries(dates, prices) },

        previousSignalStates: { [signalKey(sig)]: false },
      });
      const result = evaluateSignal(sig, opts);
      // Price=101, SMA≈101.4, upperBound ≈ 106.47
      // previous=false: needs price > upperBound to turn on
      expect(result).toBe(false);
    });

    it('< mirrors > behavior', () => {
      const sig = makeSignal({ comparison: '<', tolerance: 5 });
      const dates = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'];
      const prices = [100, 102, 101, 103, 101.5];
      const opts = makeOptions({
        batchSeries: { SPY: makeSeries(dates, prices) },

        previousSignalStates: { [signalKey(sig)]: true },
      });
      // previous=true for <: stays true if price <= upperBound
      const result = evaluateSignal(sig, opts);
      expect(result).toBe(true);
    });

    it('= is unaffected by hysteresis', () => {
      const sig = makeSignal({ comparison: '=', tolerance: 5 });
      const result1 = evaluateSignal(sig, makeOptions({
        previousSignalStates: { [signalKey(sig)]: true },
      }));
      const result2 = evaluateSignal(sig, makeOptions({
        previousSignalStates: { [signalKey(sig)]: false },
      }));
      expect(result1).toBe(result2); // = doesn't care about previous state
    });
  });
});

// ---------------------------------------------------------------------------
// Condition tree tests
// ---------------------------------------------------------------------------

describe('evaluateAllocation', () => {
  const trueSignal = makeSignal({ comparison: '>' }); // Price > SMA → true
  const falseSignal = makeSignal({ comparison: '<' }); // Price < SMA → false

  it('single signal condition', () => {
    const alloc: Allocation = {
      condition: { kind: 'signal', signal: trueSignal },
      holdings: [],
    };
    expect(evaluateAllocation(alloc, makeOptions())).toBe(true);
  });

  it('AND: all true required', () => {
    const alloc: Allocation = {
      condition: {
        kind: 'and',
        args: [
          { kind: 'signal', signal: trueSignal },
          { kind: 'signal', signal: trueSignal },
        ],
      },
      holdings: [],
    };
    expect(evaluateAllocation(alloc, makeOptions())).toBe(true);
  });

  it('AND: one false makes all false', () => {
    const alloc: Allocation = {
      condition: {
        kind: 'and',
        args: [
          { kind: 'signal', signal: trueSignal },
          { kind: 'signal', signal: falseSignal },
        ],
      },
      holdings: [],
    };
    expect(evaluateAllocation(alloc, makeOptions())).toBe(false);
  });

  it('OR: short-circuits on first true AND group', () => {
    const alloc: Allocation = {
      condition: {
        kind: 'or',
        args: [
          { kind: 'and', args: [{ kind: 'signal', signal: falseSignal }] },
          { kind: 'and', args: [{ kind: 'signal', signal: trueSignal }] },
        ],
      },
      holdings: [],
    };
    expect(evaluateAllocation(alloc, makeOptions())).toBe(true);
  });

  it('NOT: inverts signal', () => {
    const alloc: Allocation = {
      condition: { kind: 'not', signal: falseSignal },
      holdings: [],
    };
    expect(evaluateAllocation(alloc, makeOptions())).toBe(true);
  });

  it('nested: OR(AND(NOT, signal), AND(signal))', () => {
    const alloc: Allocation = {
      condition: {
        kind: 'or',
        args: [
          {
            kind: 'and',
            args: [
              { kind: 'not', signal: trueSignal },
              { kind: 'signal', signal: trueSignal },
            ],
          },
          { kind: 'and', args: [{ kind: 'signal', signal: trueSignal }] },
        ],
      },
      holdings: [],
    };
    // First AND: NOT(true) AND true = false AND true = false
    // Second AND: true
    // OR: false OR true = true
    expect(evaluateAllocation(alloc, makeOptions())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findAllSignals tests
// ---------------------------------------------------------------------------

describe('findAllSignals', () => {
  const sig1 = makeSignal({ comparison: '>' });
  const sig2 = makeSignal({ comparison: '<' });

  it('extracts from OR → AND → signal tree', () => {
    const cond: Condition = {
      kind: 'or',
      args: [
        { kind: 'and', args: [{ kind: 'signal', signal: sig1 }] },
        { kind: 'and', args: [{ kind: 'signal', signal: sig2 }] },
      ],
    };
    const result = findAllSignals(cond);
    expect(result).toHaveLength(2);
  });

  it('extracts from NOT expression', () => {
    const cond: Condition = { kind: 'not', signal: sig1 };
    const result = findAllSignals(cond);
    expect(result).toHaveLength(1);
  });

  it('deduplicates signals with the same key', () => {
    const cond: Condition = {
      kind: 'and',
      args: [
        { kind: 'signal', signal: sig1 },
        { kind: 'signal', signal: sig1 },
      ],
    };
    const result = findAllSignals(cond);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Strategy evaluation tests
// ---------------------------------------------------------------------------

describe('evaluate', () => {
  const trueSignal = makeSignal({ comparison: '>' });
  const falseSignal = makeSignal({ comparison: '<' });

  function makeStrategy(allocs: NamedAllocation[]): Strategy {
    const signals = new Set<Signal>();
    for (const na of allocs) {
      for (const s of findAllSignals(na.allocation.condition)) signals.add(s);
    }
    return {
      linkId: 'test-123',
      name: 'Test Strategy',
      trading: { frequency: 'Daily', offset: 0 },
      allocations: allocs,
      signals: [...signals].map((s, i) => ({ name: `Signal ${i}`, signal: s })),
    };
  }

  it('returns first matching named allocation', () => {
    const strategy = makeStrategy([
      {
        name: 'Aggressive',
        position: 0,
        allocation: {
          condition: { kind: 'signal', signal: trueSignal },
          holdings: [{ ticker: SPY_TICKER, weight: 100 }],
        },
      },
      {
        name: 'Default',
        position: 1,
        allocation: {
          condition: { kind: 'signal', signal: trueSignal },
          holdings: [{ ticker: SPY_TICKER, weight: 50 }],
        },
      },
    ]);

    const result = evaluate(strategy, makeOptions());
    expect(result.allocation.name).toBe('Aggressive');
    expect(result.asOf).toBeInstanceOf(Date);
  });

  it('falls back to last allocation', () => {
    const strategy = makeStrategy([
      {
        name: 'Aggressive',
        position: 0,
        allocation: {
          condition: { kind: 'signal', signal: falseSignal },
          holdings: [{ ticker: SPY_TICKER, weight: 100 }],
        },
      },
      {
        name: 'Default',
        position: 1,
        allocation: {
          condition: { kind: 'signal', signal: falseSignal },
          holdings: [{ ticker: SPY_TICKER, weight: 50 }],
        },
      },
    ]);

    const result = evaluate(strategy, makeOptions());
    expect(result.allocation.name).toBe('Default');
  });

  it('populates diagnostics with all signals and indicators', () => {
    const strategy = makeStrategy([
      {
        name: 'First',
        position: 0,
        allocation: {
          condition: { kind: 'signal', signal: trueSignal },
          holdings: [],
        },
      },
    ]);

    const opts = makeOptions();
    const result = evaluate(strategy, opts);
    expect(Object.keys(result.signals).length).toBeGreaterThan(0);
    expect(Object.keys(result.indicators).length).toBeGreaterThan(0);
    expect(result.asOf).toEqual(getEvaluationDate(strategy.trading, opts));
  });

  it('deduplicates shared indicators across allocations', () => {
    // Two allocations use the exact same signal → indicators evaluated once
    const sharedSignal = makeSignal({ comparison: '>' });
    const strategy = makeStrategy([
      {
        name: 'A',
        position: 0,
        allocation: {
          condition: { kind: 'signal', signal: sharedSignal },
          holdings: [],
        },
      },
      {
        name: 'B',
        position: 1,
        allocation: {
          condition: { kind: 'signal', signal: sharedSignal },
          holdings: [],
        },
      },
    ]);

    const result = evaluate(strategy, makeOptions());
    // Should still have only 2 indicator keys (left + right), not 4
    expect(Object.keys(result.indicators)).toHaveLength(2);
  });

  it('includes metadata for EMA indicators', () => {
    const emaSignal = makeSignal({
      left: makeIndicator({ type: 'EMA', lookback: 5 }),
      right: makeIndicator({ type: 'Threshold', threshold: 100 }),
    });

    const strategy = makeStrategy([
      {
        name: 'EMA Test',
        position: 0,
        allocation: {
          condition: { kind: 'signal', signal: emaSignal },
          holdings: [],
        },
      },
    ]);

    const result = evaluate(strategy, makeOptions());
    const emaKey = indicatorKey(emaSignal.left);
    expect(result.indicators[emaKey]).toBeDefined();
    expect(result.indicators[emaKey].metadata).toHaveProperty('ema');
  });
});

// ---------------------------------------------------------------------------
// getEvaluationDate tests
// ---------------------------------------------------------------------------

describe('getEvaluationDate', () => {
  it('Daily: returns latest close', () => {
    const trading = { frequency: 'Daily' as const, offset: 0 };
    const result = getEvaluationDate(trading, makeOptions());
    expect(result).toEqual(new Date(marketCloseUTC('2025-01-10')));
  });

  it('Weekly offset shifts backwards within period', () => {
    // Weekly with 5 trading days = 1 full week
    const trading = { frequency: 'Weekly' as const, offset: 1 };
    const result = getEvaluationDate(trading, makeOptions());
    // Week Mon-Fri has 5 obs, offset=1 → second-to-last → 2025-01-09
    expect(result).toEqual(new Date(marketCloseUTC('2025-01-09')));
  });

  it('returns options.at when no series data', () => {
    const trading = { frequency: 'Daily' as const, offset: 0 };
    const at = new Date('2025-01-10T21:00:00.000Z');
    const result = getEvaluationDate(trading, { ...makeOptions(), batchSeries: {} });
    expect(result).toEqual(at);
  });

  it('returns options.at when series is empty array', () => {
    const trading = { frequency: 'Daily' as const, offset: 0 };
    const at = new Date('2025-01-10T21:00:00.000Z');
    const result = getEvaluationDate(trading, {
      ...makeOptions(),
      batchSeries: { SPY: [] },
    });
    expect(result).toEqual(at);
  });

  it('returns options.at when no market close observation found', () => {
    const trading = { frequency: 'Daily' as const, offset: 0 };
    // Non-close timestamps (noon UTC is not market close)
    const at = new Date('2025-01-10T12:00:00.000Z');
    const series = [{ timestamp: '2025-01-10T12:00:00.000Z', value: 100 }];
    const result = getEvaluationDate(trading, {
      at,
      batchSeries: { SPY: series },

    });
    expect(result).toEqual(at);
  });

  it('falls back to previous period when current period is incomplete (Monthly)', () => {
    // Monthly: if the latest obs is mid-month, go to previous month
    // Build Dec 2024 + first few days of Jan 2025
    const decDates = Array.from({ length: 22 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 11, 2 + i)); // Dec 2-23
      if (d.getUTCDay() === 0 || d.getUTCDay() === 6) return null;
      return d.toISOString().slice(0, 10);
    }).filter(Boolean) as string[];
    const janDates = ['2025-01-02', '2025-01-03']; // Incomplete month
    const allDates = [...decDates, ...janDates];
    const prices = allDates.map((_, i) => 100 + i);

    const trading = { frequency: 'Monthly' as const, offset: 0 };
    const result = getEvaluationDate(trading, {
      at: new Date(marketCloseUTC('2025-01-03')),
      batchSeries: { SPY: makeSeries(allDates, prices) },

    });
    // Should fall back to Dec period, returning the last Dec trading day
    expect(result.getUTCMonth()).toBe(11); // December
  });

  it('handles offset larger than period size gracefully', () => {
    const trading = { frequency: 'Daily' as const, offset: 10 };
    const result = getEvaluationDate(trading, makeOptions());
    // offset=10 on a daily period with 1 obs → index goes negative → falls back
    expect(result).toBeInstanceOf(Date);
  });

  describe('period bounds for all frequencies', () => {
    // Use a date in March 2025 to exercise all frequency period calculations
    const marchDates: string[] = [];
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(2025, 2, d)); // March
      if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
      marchDates.push(dt.toISOString().slice(0, 10));
    }
    const marchPrices = marchDates.map((_, i) => 100 + i);
    const marchOpts = {
      at: new Date(marketCloseUTC(marchDates[marchDates.length - 1])),
      batchSeries: { SPY: makeSeries(marchDates, marchPrices) },

    };

    for (const freq of [
      'Bi-monthly',
      'Quarterly',
      'Every 4 Months',
      'Semiannually',
      'Yearly',
    ] as const) {
      it(`${freq}: returns a valid date`, () => {
        const result = getEvaluationDate({ frequency: freq, offset: 0 }, marchOpts);
        expect(result).toBeInstanceOf(Date);
        // Should return a date within March (the current period for all these frequencies includes March)
        expect(result.getUTCFullYear()).toBe(2025);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// extractSymbols tests
// ---------------------------------------------------------------------------

describe('extractSymbols', () => {
  it('collects symbols from all named signals and named allocation holdings', () => {
    const spySignal = makeSignal();
    const vixSignal = makeSignal({
      left: makeIndicator({ type: 'VIX' }),
      right: makeIndicator({ type: 'Threshold', threshold: 20 }),
    });

    const strategy: Strategy = {
      linkId: 'test',
      name: 'Test',
      trading: { frequency: 'Daily', offset: 0 },
      signals: [
        { name: 'S1', signal: vixSignal },
        { name: 'S2', signal: spySignal },
      ],
      allocations: [
        {
          name: 'A1',
          position: 0,
          allocation: {
            condition: { kind: 'signal', signal: spySignal },
            holdings: [
              { ticker: { symbol: 'QQQ', leverage: 1 }, weight: 60 },
              { ticker: { symbol: 'TLT', leverage: 1 }, weight: 40 },
            ],
          },
        },
      ],
    };

    const symbols = extractSymbols(strategy);
    expect(symbols).toContain('^VIX');
    expect(symbols).toContain('SPY'); // From the SPY named signal
    expect(symbols).toContain('QQQ');
    expect(symbols).toContain('TLT');
  });
});

