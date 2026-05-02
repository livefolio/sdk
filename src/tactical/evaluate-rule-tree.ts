import type { TargetWeights } from '../strategy/reconcile';
import type { AssetId } from '../interfaces/types';
import type { Comparison, FeatureRef, RuleNode, RuleTreeState, Tolerance } from './types';

function isRef(operand: FeatureRef | number): operand is FeatureRef {
  return typeof operand === 'object' && operand !== null && 'ref' in operand;
}

function resolve(operand: FeatureRef | number, values: ReadonlyMap<string, number>): number {
  if (!isRef(operand)) return operand;
  const v = values.get(operand.ref);
  if (v === undefined) {
    throw new Error(`evaluateRuleTree: feature "${operand.ref}" has no value`);
  }
  return v;
}

function rawCompare(op: Comparison['op'], l: number, r: number): boolean {
  switch (op) {
    case 'gt':
      return l > r;
    case 'lt':
      return l < r;
    case 'gte':
      return l >= r;
    case 'lte':
      return l <= r;
  }
}

function band(right: number, tol: Tolerance): { lower: number; upper: number } {
  if (tol.mode === 'absolute') {
    return { lower: right - tol.value, upper: right + tol.value };
  }
  const factor = tol.value / 100;
  return { lower: right * (1 - factor), upper: right * (1 + factor) };
}

function evalComparison(
  cond: Comparison,
  values: ReadonlyMap<string, number>,
  state: RuleTreeState,
  outState: Map<string, 0 | 1>,
): boolean {
  const l = resolve(cond.left, values);
  const r = resolve(cond.right, values);

  if (!cond.tolerance) {
    return rawCompare(cond.op, l, r);
  }
  if (cond.id === undefined) {
    throw new Error('evaluateRuleTree: comparison with tolerance requires id');
  }
  if (cond.op !== 'gt' && cond.op !== 'lt') {
    throw new Error(`evaluateRuleTree: tolerance is only supported for op gt/lt, got ${cond.op}`);
  }

  const prev = state.get(cond.id);
  const { lower, upper } = band(r, cond.tolerance);
  let result: 0 | 1;

  if (prev === undefined) {
    result = rawCompare(cond.op, l, r) ? 1 : 0;
  } else if (cond.op === 'gt') {
    if (prev === 1) result = l < lower ? 0 : 1;
    else result = l > upper ? 1 : 0;
  } else {
    if (prev === 1) result = l > upper ? 0 : 1;
    else result = l < lower ? 1 : 0;
  }

  outState.set(cond.id, result);
  return result === 1;
}

function walk(
  rules: RuleNode,
  values: ReadonlyMap<string, number>,
  state: RuleTreeState,
  outState: Map<string, 0 | 1>,
): TargetWeights {
  if (rules.op === 'allocate') {
    const out = new Map<AssetId, number>();
    for (const [assetId, weight] of Object.entries(rules.weights)) {
      out.set(assetId, weight);
    }
    return out;
  }
  return evalComparison(rules.cond, values, state, outState)
    ? walk(rules.then, values, state, outState)
    : walk(rules.else, values, state, outState);
}

export function evaluateRuleTree(
  rules: RuleNode,
  values: ReadonlyMap<string, number>,
  state: RuleTreeState = new Map(),
): { weights: TargetWeights; state: RuleTreeState } {
  const next = new Map<string, 0 | 1>(state);
  const weights = walk(rules, values, state, next);
  return { weights, state: next };
}
