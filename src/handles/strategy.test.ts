import { describe, it, expect } from 'vitest';
import { StrategyHandle } from './strategy.js';
import { SignalHandle } from './signal.js';
import { AllocationHandle } from './allocation.js';
import { IndicatorHandle } from './indicator.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

const sb = {} as TypedSupabaseClient;

function makeSignal() {
  const ind1 = new IndicatorHandle(sb, {
    type: 'VIX',
    ticker: null,
    lookback: 0,
    delay: 0,
    unit: null,
    threshold: null,
  });
  const ind2 = new IndicatorHandle(sb, {
    type: 'Threshold',
    ticker: null,
    lookback: 0,
    delay: 0,
    unit: null,
    threshold: 30,
  });
  return new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 0 });
}

function makeAllocation() {
  return new AllocationHandle(sb, [[new TickerHandle(sb, 'SPY'), 1.0]]);
}

describe('StrategyHandle construction - create mode', () => {
  it('stores options with defaults', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(sb, { name: 'Test', rules: [{ hold: alloc }] });
    expect(handle.name).toBe('Test');
    expect(handle.freq).toBe('Daily');
    expect(handle.offset).toBe(0);
    expect(handle.rules).toHaveLength(1);
  });

  it('stores explicit freq and offset', () => {
    const signal = makeSignal();
    const alloc1 = makeAllocation();
    const alloc2 = makeAllocation();
    const handle = new StrategyHandle(sb, {
      name: 'Tactical',
      freq: 'Monthly',
      offset: 2,
      rules: [{ when: [signal], hold: alloc1 }, { hold: alloc2 }],
    });
    expect(handle.freq).toBe('Monthly');
    expect(handle.offset).toBe(2);
    expect(handle.rules).toHaveLength(2);
  });

  it('throws if rules array is empty', () => {
    expect(() => new StrategyHandle(sb, { name: 'Empty', rules: [] })).toThrow('at least one rule');
  });

  it('throws if last rule has a when clause', () => {
    const signal = makeSignal();
    const alloc = makeAllocation();
    expect(() => new StrategyHandle(sb, { name: 'Bad', rules: [{ when: [signal], hold: alloc }] })).toThrow('fallback');
  });

  it('throws on .id before resolution', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(sb, { name: 'Test', rules: [{ hold: alloc }] });
    expect(() => handle.id).toThrow('not yet resolved');
  });

  it('throws on .link before resolution', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(sb, { name: 'Test', rules: [{ hold: alloc }] });
    expect(() => handle.link).toThrow('not yet resolved');
  });
});

describe('StrategyHandle construction - reference mode', () => {
  it('stores linkId with defaults', () => {
    const handle = new StrategyHandle(sb, 'abc123');
    expect(handle.name).toBeNull();
    expect(handle.freq).toBe('Daily');
    expect(handle.offset).toBe(0);
    expect(handle.rules).toHaveLength(0);
  });
});
