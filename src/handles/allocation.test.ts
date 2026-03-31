import { describe, it, expect, vi } from 'vitest';
import { AllocationHandle } from './allocation.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

function mockSupabase() {
  return {} as TypedSupabaseClient;
}

describe('AllocationHandle construction', () => {
  it('stores holdings as ticker-weight pairs', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const gld = new TickerHandle(sb, 'GLD');
    const handle = new AllocationHandle(sb, [
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
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const gld = new TickerHandle(sb, 'GLD');
    expect(
      () =>
        new AllocationHandle(sb, [
          [spy, 0.5],
          [gld, 0.3],
        ]),
    ).toThrow('weights must sum to 1');
  });

  it('accepts weights that sum to 1 within floating point tolerance', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const gld = new TickerHandle(sb, 'GLD');
    const shy = new TickerHandle(sb, 'SHY');
    expect(
      () =>
        new AllocationHandle(sb, [
          [spy, 0.33],
          [gld, 0.33],
          [shy, 0.34],
        ]),
    ).not.toThrow();
  });

  it('throws on .id before resolution', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const handle = new AllocationHandle(sb, [[spy, 1.0]]);
    expect(() => handle.id).toThrow('not yet resolved');
  });
});

describe('AllocationHandle.resolve', () => {
  it('resolves tickers, finds existing allocation by holdings JSONB', async () => {
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const allocationRow = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: tickerRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'allocations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: allocationRow, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

    const spy = new TickerHandle(sb, 'SPY');
    const handle = new AllocationHandle(sb, [[spy, 1.0]]);

    const result = await handle.resolve();

    expect(result).toEqual(allocationRow);
    expect(handle.id).toBe(50);
  });

  it('inserts when no existing allocation found', async () => {
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const newRow = { id: 51, holdings: { SPY: 0.6, GLD: 0.4 }, created_at: '' };
    const tickerRow2 = { id: 2, symbol: 'GLD', leverage: 1, created_at: '' };

    let tickerCallCount = 0;
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(() => {
                tickerCallCount++;
                return Promise.resolve({
                  data: tickerCallCount === 1 ? tickerRow : tickerRow2,
                  error: null,
                });
              }),
            }),
          }),
        };
      }
      if (table === 'allocations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: newRow, error: null }),
            }),
          }),
        };
      }
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

    const spy = new TickerHandle(sb, 'SPY');
    const gld = new TickerHandle(sb, 'GLD');
    const handle = new AllocationHandle(sb, [
      [spy, 0.6],
      [gld, 0.4],
    ]);

    const result = await handle.resolve();

    expect(result).toEqual(newRow);
    expect(handle.id).toBe(51);
  });

  it('uses leverage in key when leverage != 1', async () => {
    const tickerRow = { id: 3, symbol: 'SPXL', leverage: 3, created_at: '' };
    const allocationRow = { id: 52, holdings: { 'SPXL?L=3': 1.0 }, created_at: '' };

    const eqMock = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: allocationRow, error: null }),
      }),
    });
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: tickerRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'allocations') {
        return {
          select: vi.fn().mockReturnValue({ eq: eqMock }),
        };
      }
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

    const spxl = new TickerHandle(sb, 'SPXL', 3);
    const handle = new AllocationHandle(sb, [[spxl, 1.0]]);

    await handle.resolve();

    expect(eqMock).toHaveBeenCalledWith('holdings', JSON.stringify({ 'SPXL?L=3': 1.0 }));
  });

  it('caches resolution', async () => {
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const allocationRow = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: tickerRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'allocations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: allocationRow, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

    const spy = new TickerHandle(sb, 'SPY');
    const handle = new AllocationHandle(sb, [[spy, 1.0]]);

    await handle.resolve();
    await handle.resolve();

    const allocCalls = from.mock.calls.filter((c: string[]) => c[0] === 'allocations');
    expect(allocCalls.length).toBe(1);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const allocationRow = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: tickerRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'allocations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: allocationRow, error: null }),
              }),
            }),
          }),
        };
      }
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

    const spy = new TickerHandle(sb, 'SPY');
    const handle = new AllocationHandle(sb, [[spy, 1.0]]);

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);
    expect(r1).toEqual(r2);
    const allocCalls = from.mock.calls.filter((c: string[]) => c[0] === 'allocations');
    expect(allocCalls.length).toBe(1);
  });
});
