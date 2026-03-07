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

  it('throws when Default allocation is not last', () => {
    const draft = makeDraft();
    draft.allocations = [draft.allocations[1], draft.allocations[0]];

    expect(() => compileRules(draft)).toThrow('Allocation "Default" must be the final fallback allocation.');
  });

  it('throws when a condition references unknown signal names', () => {
    const draft = makeDraft();
    draft.allocations[0].condition = { kind: 'signal', signalName: 'Missing' };

    expect(() => compileRules(draft)).toThrow('Unknown signal reference: "Missing".');
  });
});
