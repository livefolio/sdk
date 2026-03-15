import { describe, expect, it } from 'vitest';
import type { StrategyDraft } from './types';
import { compileDraftStrategy, strategyToDraft } from './compile';

function makeDraft(): StrategyDraft {
  return {
    name: 'Custom Strategy',
    trading: { frequency: 'Daily', offset: 0 },
    signals: [
      {
        name: 'Signal 1',
        comparison: '>',
        tolerance: 0,
        left: { type: 'Price', ticker: 'SPY', lookback: 1, delay: 0, threshold: null },
        right: { type: 'SMA', ticker: 'SPY', lookback: 200, delay: 0, threshold: null },
      },
    ],
    allocations: [
      {
        name: 'Risk On',
        groups: [[{ signalName: 'Signal 1', not: false }]],
        holdings: [{ ticker: { symbol: 'TQQQ', leverage: 1 }, weight: 100 }],
        rebalance: { mode: 'drift', driftPct: 5 },
      },
      {
        name: 'Default',
        groups: [[{ signalName: 'Signal 1', not: true }]],
        holdings: [{ ticker: { symbol: 'BIL', leverage: 1 }, weight: 100 }],
        rebalance: { mode: 'on_change' },
      },
    ],
  };
}

describe('compileDraftStrategy', () => {
  it('compiles a builder draft into an executable strategy', () => {
    const strategy = compileDraftStrategy(makeDraft());

    expect(strategy.name).toBe('Custom Strategy');
    expect(strategy.signals[0].name).toBe('Signal 1');
    expect(strategy.allocations[0].allocation.condition.kind).toBe('and');
    expect(strategy.allocations[1].allocation.condition.kind).toBe('and');
    expect(strategy.allocations[0].allocation.rebalance).toEqual({ mode: 'drift', driftPct: 5 });
    expect(strategy.allocations[1].allocation.rebalance).toEqual({ mode: 'on_change' });
  });

  it('throws when Default allocation is not last', () => {
    const draft = makeDraft();
    draft.allocations = [draft.allocations[1], draft.allocations[0]];

    expect(() => compileDraftStrategy(draft)).toThrow('Allocation "Default" must be the final fallback allocation.');
  });

  it('throws when allocation holdings do not sum to 100', () => {
    const draft = makeDraft();
    draft.allocations[0].holdings[0].weight = 90;

    expect(() => compileDraftStrategy(draft)).toThrow('Allocation "Risk On" weights must sum to 100.');
  });

  it('throws when allocation holdings contain non-finite weights', () => {
    const draft = makeDraft();
    draft.allocations[0].holdings[0].weight = Number.NaN;

    expect(() => compileDraftStrategy(draft)).toThrow('Allocation "Risk On" has a non-finite holding weight.');
  });

  it('round-trips strategy back to builder draft shape', () => {
    const compiled = compileDraftStrategy(makeDraft());
    const roundTrip = strategyToDraft(compiled);

    expect(roundTrip.name).toBe('Custom Strategy');
    expect(roundTrip.signals[0].name).toBe('Signal 1');
    expect(roundTrip.allocations[0].groups).toEqual([[{ signalName: 'Signal 1', not: false }]]);
    expect(roundTrip.allocations[1].groups).toEqual([[{ signalName: 'Signal 1', not: true }]]);
    expect(roundTrip.allocations[0].rebalance).toEqual({ mode: 'drift', driftPct: 5 });
    expect(roundTrip.allocations[1].rebalance).toEqual({ mode: 'on_change' });
  });
});
