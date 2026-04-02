import type { StorageProvider } from '../providers/storage';

export class TickerHandle {
  readonly symbol: string;
  readonly leverage: number;

  private _storage: StorageProvider;
  private _resolvedId: number | null = null;
  private _resolving: Promise<{ id: number }> | null = null;

  constructor(storage: StorageProvider, symbol: string, leverage: number = 1) {
    this._storage = storage;
    this.symbol = symbol.toUpperCase();
    this.leverage = leverage;
  }

  get id(): number {
    if (this._resolvedId == null)
      throw new Error('TickerHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolvedId;
  }

  async resolve(): Promise<{ id: number }> {
    if (this._resolvedId != null) return { id: this._resolvedId };
    if (!this._resolving) this._resolving = this._doResolve();
    return this._resolving;
  }

  static fromResolved(storage: StorageProvider, id: number, symbol: string, leverage: number): TickerHandle {
    const handle = new TickerHandle(storage, symbol, leverage);
    handle._resolvedId = id;
    return handle;
  }

  private async _doResolve(): Promise<{ id: number }> {
    const result = await this._storage.tickers.upsert(this.symbol, this.leverage);
    this._resolvedId = result.id;
    return result;
  }
}
