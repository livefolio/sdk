import { describe, it, expect, vi } from 'vitest';
import { TickerHandle } from './ticker';
import type { StorageProvider } from '../providers/storage';

function mockStorage(overrides?: { tickers?: Partial<StorageProvider['tickers']> }): StorageProvider {
  return {
    tickers: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 42 }),
      ...overrides?.tickers,
    },
    indicators: {} as StorageProvider['indicators'],
    signals: {} as StorageProvider['signals'],
    allocations: {} as StorageProvider['allocations'],
    strategies: {} as StorageProvider['strategies'],
    tradingDays: {} as StorageProvider['tradingDays'],
  };
}

describe('TickerHandle', () => {
  it('uppercases symbol and stores leverage', () => {
    const handle = new TickerHandle(mockStorage(), 'spy', 2);
    expect(handle.symbol).toBe('SPY');
    expect(handle.leverage).toBe(2);
  });

  it('defaults leverage to 1', () => {
    const handle = new TickerHandle(mockStorage(), 'SPY');
    expect(handle.leverage).toBe(1);
  });

  it('throws on .id before resolution', () => {
    const handle = new TickerHandle(mockStorage(), 'SPY');
    expect(() => handle.id).toThrow('not yet resolved');
  });

  it('resolve() calls storage.tickers.findOrCreate and sets .id', async () => {
    const storage = mockStorage();
    const handle = new TickerHandle(storage, 'qqq', 3);

    const result = await handle.resolve();

    expect(result).toEqual({ id: 42 });
    expect(handle.id).toBe(42);
    expect(storage.tickers.findOrCreate).toHaveBeenCalledWith('QQQ', 3);
  });

  it('resolve() caches — only one findOrCreate call', async () => {
    const storage = mockStorage();
    const handle = new TickerHandle(storage, 'SPY');

    await handle.resolve();
    await handle.resolve();

    expect(storage.tickers.findOrCreate).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const storage = mockStorage();
    const handle = new TickerHandle(storage, 'SPY');

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);

    expect(r1).toEqual({ id: 42 });
    expect(r2).toEqual({ id: 42 });
    expect(storage.tickers.findOrCreate).toHaveBeenCalledTimes(1);
  });

  it('fromResolved() creates a pre-resolved handle', () => {
    const storage = mockStorage();
    const handle = TickerHandle.fromResolved(storage, 99, 'AAPL', 1);

    expect(handle.id).toBe(99);
    expect(handle.symbol).toBe('AAPL');
    expect(handle.leverage).toBe(1);
    // Should not have called upsert
    expect(storage.tickers.findOrCreate).not.toHaveBeenCalled();
  });
});
