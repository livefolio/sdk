import type { AssetId } from '../interfaces/types';
import type { ReturnMode } from '../features/indicators/return';

export type AssetRef = {
  id: AssetId;
  symbol: string;
  exchange?: string;
};

export type SyntheticAsset = {
  id: AssetId;
  symbol: string;
  underlying: AssetRef;
  leverage: number;
  expense?: number;
  tradeAs?: AssetRef;
};

export type RebalanceFrequency = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';

export type RebalanceConfig = {
  frequency: RebalanceFrequency;
};

export type TacticalFeatureSpec =
  | { id: string; kind: 'price'; asset: AssetRef; delay?: number }
  | { id: string; kind: 'sma'; asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'ema'; asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'rsi'; asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'return'; asset: AssetRef; period: number; mode?: ReturnMode; delay?: number }
  | { id: string; kind: 'volatility'; asset: AssetRef; period: number; delay?: number }
  | { id: string; kind: 'drawdown'; asset: AssetRef; period: number; delay?: number };

export type TacticalFeatureKind = TacticalFeatureSpec['kind'];

export type FeatureRef = { ref: string };

export type ComparisonOp = 'gt' | 'lt' | 'gte' | 'lte';

export type Tolerance = {
  value: number;
  mode: 'absolute' | 'relative';
};

export type Comparison = {
  op: ComparisonOp;
  left: FeatureRef | number;
  right: FeatureRef | number;
  tolerance?: Tolerance;
  id?: string;
};

export type AllocateNode = {
  op: 'allocate';
  weights: Record<AssetId, number>;
};

export type IfNode = {
  op: 'if';
  cond: Comparison;
  then: RuleNode;
  else: RuleNode;
};

export type RuleNode = AllocateNode | IfNode;

export type TacticalSpec = {
  kind: 'tactical/v0';
  universe: AssetRef[];
  synthetics?: SyntheticAsset[];
  rebalance?: RebalanceConfig;
  features: TacticalFeatureSpec[];
  rules: RuleNode;
};

export type RuleTreeState = ReadonlyMap<string, 0 | 1>;
