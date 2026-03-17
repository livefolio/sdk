import { describe, expect, it } from 'vitest';
import type { StrategyDraft } from './types';
import { compileRules } from './rules';

function makeDraft(): StrategyDraft {
  return {
    linkId: 'draft-1',
    name: 'Draft Strategy',
    trading: { frequency: 'Daily', offset: 0 },
    signals: [
      {
        name: 'Uptrend',
        signal: {
          left: {
            type: 'Price',
            ticker: { symbol: 'SPY', leverage: 1 },
            lookback: 1,
            delay: 0,
            unit: null,
            threshold: null,
          },
          comparison: '>',
          right: {
            type: 'SMA',
            ticker: { symbol: 'SPY', leverage: 1 },
            lookback: 200,
            delay: 0,
            unit: null,
            threshold: null,
          },
          tolerance: 0,
        },
      },
    ],
    allocations: [
      {
        name: 'Risk On',
        condition: { kind: 'signal', signalName: 'Uptrend' },
        holdings: [{ ticker: { symbol: 'TQQQ', leverage: 1 }, weight: 100 }],
      },
      {
        name: 'Default',
        condition: { kind: 'not', signalName: 'Uptrend' },
        holdings: [{ ticker: { symbol: 'BIL', leverage: 1 }, weight: 100 }],
      },
    ],
  };
}

describe('compileRules', () => {
  it('compiles a draft into executable strategy', () => {
    const compiled = compileRules(makeDraft());

    expect(compiled.signals).toHaveLength(1);
    expect(compiled.allocations).toHaveLength(2);
    expect(compiled.allocations[0].allocation.condition.kind).toBe('signal');
    expect(compiled.allocations[1].allocation.condition.kind).toBe('not');
  });

  it('supports custom fallback allocation names', () => {
    const draft = makeDraft();
    draft.allocations[1].name = 'Cash Fallback';

    const compiled = compileRules(draft);
    expect(compiled.allocations[1].name).toBe('Cash Fallback');
  });

  it('throws when a condition references unknown signal names', () => {
    const draft = makeDraft();
    draft.allocations[0].condition = { kind: 'signal', signalName: 'Missing' };

    expect(() => compileRules(draft)).toThrow('Unknown signal reference: "Missing".');
  });

  it('throws when a signal name is empty', () => {
    const draft = makeDraft();
    draft.signals[0].name = ' ';

    expect(() => compileRules(draft)).toThrow('Signal names must be non-empty.');
  });

  it('throws when allocation names are duplicated (case-insensitive)', () => {
    const draft = makeDraft();
    draft.allocations[0].name = 'DEFAULT';

    expect(() => compileRules(draft)).toThrow('Duplicate allocation name: "Default".');
  });

  it('throws when allocation has no holdings', () => {
    const draft = makeDraft();
    draft.allocations[0].holdings = [];

    expect(() => compileRules(draft)).toThrow('Allocation "Risk On" must include at least one holding.');
  });

  it('throws when allocation includes non-finite holding weight', () => {
    const draft = makeDraft();
    draft.allocations[0].holdings = [{ ticker: { symbol: 'TQQQ', leverage: 1 }, weight: Number.NaN }];

    expect(() => compileRules(draft)).toThrow('Allocation "Risk On" has a non-finite holding weight.');
  });
});
