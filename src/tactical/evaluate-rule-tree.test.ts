import { describe, it, expect } from 'vitest';
import { evaluateRuleTree } from './evaluate-rule-tree';
import type { RuleNode, RuleTreeState } from './types';

const allocate = (weights: Record<string, number>): RuleNode => ({ op: 'allocate', weights });

describe('evaluateRuleTree (stateless)', () => {
  it('returns weights from a bare allocate node', () => {
    const out = evaluateRuleTree(allocate({ 'us:SPY': 0.6, 'us:AGG': 0.4 }), new Map());
    expect(out.weights.get('us:SPY')).toBe(0.6);
    expect(out.weights.get('us:AGG')).toBe(0.4);
    expect(out.weights.size).toBe(2);
    expect(out.state.size).toBe(0);
  });

  it('takes the then branch when comparison is true (ref vs literal)', () => {
    const rule: RuleNode = {
      op: 'if',
      cond: { op: 'gt', left: { ref: 'rsi' }, right: 70 },
      then: allocate({ 'us:SPY': 0 }),
      else: allocate({ 'us:SPY': 1 }),
    };
    expect(evaluateRuleTree(rule, new Map([['rsi', 75]])).weights.get('us:SPY')).toBe(0);
    expect(evaluateRuleTree(rule, new Map([['rsi', 50]])).weights.get('us:SPY')).toBe(1);
  });

  it('handles all four comparison ops at the equality boundary', () => {
    const at = (op: 'gt' | 'lt' | 'gte' | 'lte'): RuleNode => ({
      op: 'if',
      cond: { op, left: { ref: 'a' }, right: { ref: 'b' } },
      then: allocate({ 'us:X': 1 }),
      else: allocate({}),
    });
    const eq = new Map([
      ['a', 5],
      ['b', 5],
    ]);
    expect(evaluateRuleTree(at('gt'), eq).weights.has('us:X')).toBe(false);
    expect(evaluateRuleTree(at('gte'), eq).weights.has('us:X')).toBe(true);
    expect(evaluateRuleTree(at('lt'), eq).weights.has('us:X')).toBe(false);
    expect(evaluateRuleTree(at('lte'), eq).weights.has('us:X')).toBe(true);
  });

  it('walks nested ifs', () => {
    const rule: RuleNode = {
      op: 'if',
      cond: { op: 'gt', left: { ref: 'a' }, right: 0 },
      then: {
        op: 'if',
        cond: { op: 'gt', left: { ref: 'b' }, right: 0 },
        then: allocate({ 'us:X': 1 }),
        else: allocate({ 'us:Y': 1 }),
      },
      else: allocate({ 'us:Z': 1 }),
    };
    expect(
      evaluateRuleTree(
        rule,
        new Map([
          ['a', 1],
          ['b', 1],
        ]),
      ).weights.has('us:X'),
    ).toBe(true);
    expect(
      evaluateRuleTree(
        rule,
        new Map([
          ['a', 1],
          ['b', -1],
        ]),
      ).weights.has('us:Y'),
    ).toBe(true);
    expect(
      evaluateRuleTree(
        rule,
        new Map([
          ['a', -1],
          ['b', 1],
        ]),
      ).weights.has('us:Z'),
    ).toBe(true);
  });

  it('throws when a referenced feature has no value', () => {
    const rule: RuleNode = {
      op: 'if',
      cond: { op: 'gt', left: { ref: 'missing' }, right: 0 },
      then: allocate({}),
      else: allocate({}),
    };
    expect(() => evaluateRuleTree(rule, new Map())).toThrow(/feature "missing" has no value/);
  });
});

describe('evaluateRuleTree (tolerant / hysteresis)', () => {
  const tolGt = (cmpId: string, value: number, mode: 'absolute' | 'relative'): RuleNode => ({
    op: 'if',
    cond: {
      op: 'gt',
      left: { ref: 'price' },
      right: { ref: 'sma' },
      tolerance: { value, mode },
      id: cmpId,
    },
    then: allocate({ 'us:SPY': 1 }),
    else: allocate({}),
  });

  it('first call uses the raw compare and records state', () => {
    const rule = tolGt('px_vs_sma', 5, 'absolute');
    const out = evaluateRuleTree(
      rule,
      new Map([
        ['price', 100],
        ['sma', 99],
      ]),
    );
    expect(out.weights.has('us:SPY')).toBe(true);
    expect(out.state.get('px_vs_sma')).toBe(1);
  });

  it('with prev=1, holds long inside the lower band (absolute)', () => {
    const rule = tolGt('px_vs_sma', 5, 'absolute');
    const state: RuleTreeState = new Map([['px_vs_sma', 1]]);
    const out = evaluateRuleTree(
      rule,
      new Map([
        ['price', 96],
        ['sma', 100],
      ]),
      state,
    );
    expect(out.weights.has('us:SPY')).toBe(true);
    expect(out.state.get('px_vs_sma')).toBe(1);
  });

  it('with prev=1, flips to short below lower (absolute)', () => {
    const rule = tolGt('px_vs_sma', 5, 'absolute');
    const state: RuleTreeState = new Map([['px_vs_sma', 1]]);
    const out = evaluateRuleTree(
      rule,
      new Map([
        ['price', 94],
        ['sma', 100],
      ]),
      state,
    );
    expect(out.weights.has('us:SPY')).toBe(false);
    expect(out.state.get('px_vs_sma')).toBe(0);
  });

  it('with prev=0, requires breaking above upper to flip (absolute)', () => {
    const rule = tolGt('px_vs_sma', 5, 'absolute');
    const state: RuleTreeState = new Map([['px_vs_sma', 0]]);
    expect(
      evaluateRuleTree(
        rule,
        new Map([
          ['price', 104],
          ['sma', 100],
        ]),
        state,
      ).state.get('px_vs_sma'),
    ).toBe(0);
    expect(
      evaluateRuleTree(
        rule,
        new Map([
          ['price', 106],
          ['sma', 100],
        ]),
        state,
      ).state.get('px_vs_sma'),
    ).toBe(1);
  });

  it('relative mode scales the band by percentage', () => {
    const rule = tolGt('px_vs_sma', 5, 'relative');
    const state: RuleTreeState = new Map([['px_vs_sma', 1]]);
    expect(
      evaluateRuleTree(
        rule,
        new Map([
          ['price', 96],
          ['sma', 100],
        ]),
        state,
      ).state.get('px_vs_sma'),
    ).toBe(1);
    expect(
      evaluateRuleTree(
        rule,
        new Map([
          ['price', 94],
          ['sma', 100],
        ]),
        state,
      ).state.get('px_vs_sma'),
    ).toBe(0);
  });

  it('lt is symmetric with gt under hysteresis', () => {
    const rule: RuleNode = {
      op: 'if',
      cond: {
        op: 'lt',
        left: { ref: 'rsi' },
        right: 30,
        tolerance: { value: 5, mode: 'absolute' },
        id: 'oversold',
      },
      then: allocate({ 'us:X': 1 }),
      else: allocate({}),
    };
    const wasTrue: RuleTreeState = new Map([['oversold', 1]]);
    expect(evaluateRuleTree(rule, new Map([['rsi', 34]]), wasTrue).state.get('oversold')).toBe(1);
    expect(evaluateRuleTree(rule, new Map([['rsi', 36]]), wasTrue).state.get('oversold')).toBe(0);
  });

  it('throws when tolerance is set without id', () => {
    const rule: RuleNode = {
      op: 'if',
      cond: { op: 'gt', left: { ref: 'a' }, right: 0, tolerance: { value: 1, mode: 'absolute' } },
      then: allocate({}),
      else: allocate({}),
    };
    expect(() => evaluateRuleTree(rule, new Map([['a', 1]]))).toThrow(/tolerance requires id/);
  });

  it('throws on tolerance with gte/lte', () => {
    const rule: RuleNode = {
      op: 'if',
      cond: {
        op: 'gte',
        left: { ref: 'a' },
        right: 0,
        tolerance: { value: 1, mode: 'absolute' },
        id: 'x',
      },
      then: allocate({}),
      else: allocate({}),
    };
    expect(() => evaluateRuleTree(rule, new Map([['a', 1]]))).toThrow(/only supported for op gt\/lt/);
  });

  it('does not mutate input state', () => {
    const rule = tolGt('px_vs_sma', 5, 'absolute');
    const state: RuleTreeState = new Map([['px_vs_sma', 0]]);
    evaluateRuleTree(
      rule,
      new Map([
        ['price', 110],
        ['sma', 100],
      ]),
      state,
    );
    expect(state.get('px_vs_sma')).toBe(0);
  });

  it('hysteresis prevents oscillation across a noisy series', () => {
    const rule = tolGt('px_vs_sma', 5, 'absolute');
    const sma = 100;
    const series = [99, 101, 99, 101, 99];
    let state: RuleTreeState = new Map();
    const flips: number[] = [];
    let prev: 0 | 1 | undefined;
    for (const price of series) {
      const out = evaluateRuleTree(
        rule,
        new Map([
          ['price', price],
          ['sma', sma],
        ]),
        state,
      );
      const cur = out.state.get('px_vs_sma');
      if (prev !== undefined && prev !== cur) flips.push(price);
      prev = cur;
      state = out.state;
    }
    expect(flips.length).toBe(0);
  });
});
