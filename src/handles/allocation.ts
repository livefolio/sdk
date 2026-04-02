import type { StorageProvider } from '../providers/storage';
import { TickerHandle } from './ticker';

export class AllocationHandle {
  readonly holdings: [TickerHandle, number][];

  private _storage: StorageProvider;
  private _resolvedId: number | null = null;
  private _resolving: Promise<{ id: number }> | null = null;

  constructor(storage: StorageProvider, holdings: [TickerHandle, number][]) {
    const total = holdings.reduce((sum, [, weight]) => sum + weight, 0);
    if (Math.abs(total - 1) > 1e-9) {
      throw new Error(`Allocation weights must sum to 1, got ${total}`);
    }
    this._storage = storage;
    this.holdings = holdings;
  }

  get id(): number {
    if (this._resolvedId == null)
      throw new Error('AllocationHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolvedId;
  }

  async resolve(): Promise<{ id: number }> {
    if (this._resolvedId != null) return { id: this._resolvedId };
    if (!this._resolving) this._resolving = this._doResolve();
    return this._resolving;
  }

  static fromResolved(storage: StorageProvider, id: number, holdings: [TickerHandle, number][]): AllocationHandle {
    const handle = new AllocationHandle(storage, holdings);
    handle._resolvedId = id;
    return handle;
  }

  private async _doResolve(): Promise<{ id: number }> {
    await Promise.all(this.holdings.map(([ticker]) => ticker.resolve()));

    const holdingsJson: Record<string, number> = {};
    for (const [ticker, weight] of this.holdings) {
      const key = ticker.leverage !== 1 ? `${ticker.symbol}?L=${ticker.leverage}` : ticker.symbol;
      holdingsJson[key] = weight;
    }

    const result = await this._storage.allocations.findOrCreate(holdingsJson);
    this._resolvedId = result.id;
    return result;
  }
}
