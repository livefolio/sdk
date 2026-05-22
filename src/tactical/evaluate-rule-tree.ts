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
    case 'eq':
      return l === r;
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
  if (cond.op !== 'gt' && cond.op !== 'lt' && cond.op !== 'eq') {
    throw new Error(`evaluateRuleTree: tolerance is only supported for op gt/lt/eq, got ${cond.op}`);
  }

  const prev = state.get(cond.id);
  const { lower, upper } = band(r, cond.tolerance);
  let result: 0 | 1;

  if (cond.op === 'eq') {
    result = l >= lower && l <= upper ? 1 : 0;
  } else if (prev === undefined) {
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

/**
 * Evaluates a {@link RuleNode} tree against a resolved set of feature values
 * and returns the target allocation weights together with the updated
 * hysteresis state.
 *
 * The tree is walked depth-first. At each {@link IfNode} the comparison is
 * evaluated (with hysteresis applied when `tolerance` and `id` are present)
 * and the walk follows either `then` or `else`. Evaluation terminates at an
 * {@link AllocateNode} whose `weights` map is returned verbatim.
 *
 * Hysteresis: when a {@link Comparison} carries a `tolerance`, the previous
 * outcome in `state` is used to decide whether to flip the result. The updated
 * outcomes for all visited comparisons are collected in the returned `state` map.
 *
 * Throws if a {@link FeatureRef} resolves to `undefined` (the caller should
 * suppress this with a guard or catch-block, as {@link fromSpec} does).
 *
 * @param rules  - Root of the rule tree to evaluate.
 * @param values - Resolved feature values, keyed by feature id. Must contain
 *   every `ref` string used in the tree; missing keys throw.
 * @param state  - Prior hysteresis state from the previous evaluation step.
 *   Pass an empty `Map` on the first call.
 * @returns An object with:
 *   - `weights` — target portfolio weights as a `Map<AssetId, number>`.
 *   - `state`   — updated {@link RuleTreeState} to pass to the next step.
 *
 * @example
 * ```ts
 * import { evaluateRuleTree } from '@livefolio/sdk';
 * import type { RuleNode, RuleTreeState } from '@livefolio/sdk';
 *
 * const rules: RuleNode = {
 *   op:   'if',
 *   cond: { op: 'gt', left: { ref: 'price' }, right: { ref: 'sma200' } },
 *   then: { op: 'allocate', weights: { SPY: 1 } },
 *   else: { op: 'allocate', weights: { SHY: 1 } },
 * };
 *
 * let state: RuleTreeState = new Map();
 * const values = new Map([['price', 450], ['sma200', 420]]);
 * const result = evaluateRuleTree(rules, values, state);
 * // result.weights → Map { 'SPY' => 1 }
 * state = result.state;
 * ```
 */
export function evaluateRuleTree(
  rules: RuleNode,
  values: ReadonlyMap<string, number>,
  state: RuleTreeState = new Map(),
): { weights: TargetWeights; state: RuleTreeState } {
  const next = new Map<string, 0 | 1>(state);
  const weights = walk(rules, values, state, next);
  return { weights, state: next };
}
