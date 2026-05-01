import type { AssetId, DateRange, Frequency, Series } from './types';

export type FeatureScope = { kind: 'asset'; asset: AssetId } | { kind: 'universe'; universeHash: string };

export type FeatureKey = {
  feature: string;
  paramsHash: string;
  scope: FeatureScope;
  range: DateRange;
  freq: Frequency;
};

export interface FeatureCache {
  get(key: FeatureKey): Promise<Series | undefined>;
  set(key: FeatureKey, series: Series): Promise<void>;
  invalidate?(prefix: Partial<FeatureKey>): Promise<void>;
}
