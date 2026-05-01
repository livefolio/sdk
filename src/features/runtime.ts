import type { Asset, DateRange, Frequency, Series } from '../interfaces/types';
import type { DataFeed } from '../interfaces/data-feed';
import type { FeatureCache, FeatureKey } from '../interfaces/feature-cache';
import { collectBars, barsToSeries, type BarField } from './series-utils';
import { getFeatureCompute, paramsHash, type FeatureSpec } from './spec';

export type FeatureRuntimeOptions = {
  dataFeed: DataFeed;
  featureCache: FeatureCache;
  range: DateRange;
  freq: Frequency;
  field?: BarField;
};

export class FeatureRuntime {
  private readonly opts: FeatureRuntimeOptions;
  private readonly basePromises = new Map<string, Promise<Series>>();

  constructor(opts: FeatureRuntimeOptions) {
    this.opts = { field: 'close', ...opts };
  }

  private baseKey(asset: Asset): string {
    const r = this.opts.range;
    return `${asset.id}|${this.opts.freq}|${r.from.toISOString()}|${r.to.toISOString()}|${this.opts.field}`;
  }

  private async baseSeries(asset: Asset): Promise<Series> {
    const k = this.baseKey(asset);
    let p = this.basePromises.get(k);
    if (p) return p;
    p = (async () => {
      const bars = await collectBars(this.opts.dataFeed.bars(asset, this.opts.range, this.opts.freq));
      return barsToSeries(bars, this.opts.field);
    })();
    this.basePromises.set(k, p);
    return p;
  }

  private cacheKey(spec: FeatureSpec, asset: Asset): FeatureKey {
    return {
      feature: spec.kind,
      paramsHash: paramsHash(spec),
      scope: { kind: 'asset', asset: asset.id },
      range: this.opts.range,
      freq: this.opts.freq,
    };
  }

  async compute(spec: FeatureSpec, asset: Asset): Promise<Series> {
    const key = this.cacheKey(spec, asset);
    const cached = await this.opts.featureCache.get(key);
    if (cached) return cached;
    const base = await this.baseSeries(asset);
    const compute = getFeatureCompute(spec.kind);
    const result = compute(base, spec);
    await this.opts.featureCache.set(key, result);
    return result;
  }
}
