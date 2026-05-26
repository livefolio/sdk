export type {
  AssetRef,
  SyntheticAsset,
  RebalanceFrequency,
  RebalanceConfig,
  TacticalFeatureSpec,
  TacticalFeatureKind,
  FeatureRef,
  Tolerance,
  Comparison,
  ComparisonOp,
  AllocateNode,
  IfNode,
  RuleNode,
  TacticalSpec,
  RuleTreeState,
} from './types';
export { evaluateRuleTree } from './evaluate-rule-tree';
export { evaluateFeatureSpecs } from './evaluate-feature-specs';
export { withSynthetics, withStreamingSynthetics, type WithStreamingSyntheticsOptions } from './synthetics';
export {
  fromSpec,
  isRebalanceDay,
  periodKey,
  _resetTacticalDeprecationWarningForTesting,
  type TacticalFeatures,
  type FromSpecOptions,
} from './from-spec';
export { currentWeights, withinDriftBand } from './drift-band';
export { applyTaxPolicy } from './apply-tax-policy';
export type { TaxPolicyConfig } from './apply-tax-policy';
export { applyTaxLossHarvesting } from './apply-tax-loss-harvest';
export type { TLHConfig, TLHResult } from './apply-tax-loss-harvest';
