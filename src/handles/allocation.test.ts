import { describe, it, expect, vi } from 'vitest';
import { AllocationHandle } from './allocation';
import { TickerHandle } from './ticker';
import type { StorageProvider } from '../providers/storage';

function mockStorage(overrides?: {
  allocations?: Partial<StorageProvider['allocations']>;
  tickers?: Partial<StorageProvider['tickers']>;
}): StorageProvider {
  return {
    tickers: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 1 }),
      ...overrides?.tickers,
    },
    indicators: {} as StorageProvider['indicators'],
    signals: {} as StorageProvider['signals'],
    allocations: {
      findOrCreate: vi.fn().mockResolvedValue({ id: 10 }),
      ...overrides?.allocations,
    },
    strategies: {} as StorageProvider['strategies'],
    tradingDays: {} as StorageProvider['tradingDays'],
  };
}

describe('AllocationHandle construction', () => {
  it('stores holdings as ticker-weight pairs', () => {
    const storage = mockStorage();
    const spy = new TickerHandle(storage, 'SPY');
    const gld = new TickerHandle(storage, 'GLD');
    const handle = new AllocationHandle(storage, [
      [spy, 0.75],
      [gld, 0.25],
    ]);

    expect(handle.holdings).toHaveLength(2);
    expect(handle.holdings[0][0]).toBe(spy);
    expect(handle.holdings[0][1]).toBe(0.75);
    expect(handle.holdings[1][0]).toBe(gld);
    expect(handle.holdings[1][1]).toBe(0.25);
  });

  it('throws if weights do not sum to 1', () => {
    const storage = mockStorage();
    const spy = new TickerHandle(storage, 'SPY');
    const gld = new TickerHandle(storage, 'GLD');
    expect(
      () =>
        new AllocationHandle(storage, [
          [spy, 0.5],
          [gld, 0.3],
        ]),
    ).toThrow('weights must sum to 1');
  });

  it('accepts weights that sum to 1 within floating point tolerance', () => {
    const storage = mockStorage();
    const spy = new TickerHandle(storage, 'SPY');
    const gld = new TickerHandle(storage, 'GLD');
    const shy = new TickerHandle(storage, 'SHY');
    expect(
      () =>
        new AllocationHandle(storage, [
          [spy, 0.33],
          [gld, 0.33],
          [shy, 0.34],
        ]),
    ).not.toThrow();
  });

  it('throws on .id before resolution', () => {
    const storage = mockStorage();
    const spy = new TickerHandle(storage, 'SPY');
    const handle = new AllocationHandle(storage, [[spy, 1.0]]);
    expect(() => handle.id).toThrow('not yet resolved');
  });
});

describe('AllocationHandle.resolve', () => {
  it('resolves tickers and calls findOrCreate with correct holdings JSON', async () => {
    const storage = mockStorage();
    const spy = new TickerHandle(storage, 'SPY');
    const handle = new AllocationHandle(storage, [[spy, 1.0]]);

    const result = await handle.resolve();

    expect(result).toEqual({ id: 10 });
    expect(handle.id).toBe(10);
    expect(storage.tickers.findOrCreate).toHaveBeenCalledWith('SPY', 1);
    expect(storage.allocations.findOrCreate).toHaveBeenCalledWith({ SPY: 1.0 });
  });

  it('resolves multiple tickers before creating allocation', async () => {
    let tickerCallCount = 0;
    const storage = mockStorage({
      tickers: {
        findOrCreate: vi.fn().mockImplementation(() => {
          tickerCallCount++;
          return Promise.resolve({ id: tickerCallCount });
        }),
      },
      allocations: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 20 }),
      },
    });

    const spy = new TickerHandle(storage, 'SPY');
    const gld = new TickerHandle(storage, 'GLD');
    const handle = new AllocationHandle(storage, [
      [spy, 0.6],
      [gld, 0.4],
    ]);

    const result = await handle.resolve();

    expect(result).toEqual({ id: 20 });
    expect(handle.id).toBe(20);
    expect(storage.tickers.findOrCreate).toHaveBeenCalledTimes(2);
    expect(storage.allocations.findOrCreate).toHaveBeenCalledWith({ SPY: 0.6, GLD: 0.4 });
  });

  it('uses leverage in key when leverage != 1', async () => {
    const storage = mockStorage();
    const spxl = new TickerHandle(storage, 'SPXL', 3);
    const handle = new AllocationHandle(storage, [[spxl, 1.0]]);

    await handle.resolve();

    expect(storage.allocations.findOrCreate).toHaveBeenCalledWith({ 'SPXL?L=3': 1.0 });
  });

  it('caches resolution — only one findOrCreate call', async () => {
    const storage = mockStorage();
    const spy = new TickerHandle(storage, 'SPY');
    const handle = new AllocationHandle(storage, [[spy, 1.0]]);

    await handle.resolve();
    await handle.resolve();

    expect(storage.allocations.findOrCreate).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const storage = mockStorage();
    const spy = new TickerHandle(storage, 'SPY');
    const handle = new AllocationHandle(storage, [[spy, 1.0]]);

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);

    expect(r1).toEqual({ id: 10 });
    expect(r2).toEqual({ id: 10 });
    expect(storage.allocations.findOrCreate).toHaveBeenCalledTimes(1);
  });
});

describe('AllocationHandle.fromResolved', () => {
  it('creates a pre-resolved handle with .id accessible immediately', () => {
    const storage = mockStorage();
    const spy = TickerHandle.fromResolved(storage, 1, 'SPY', 1);
    const handle = AllocationHandle.fromResolved(storage, 99, [[spy, 1.0]]);

    expect(handle.id).toBe(99);
    expect(handle.holdings).toHaveLength(1);
    expect(handle.holdings[0][0]).toBe(spy);
    expect(handle.holdings[0][1]).toBe(1.0);
    // Should not have called findOrCreate
    expect(storage.allocations.findOrCreate).not.toHaveBeenCalled();
  });
});
