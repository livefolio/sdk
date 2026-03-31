import { describe, it, expect, vi } from 'vitest';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

function mockSupabase() {
  return {} as TypedSupabaseClient;
}

describe('TickerHandle', () => {
  it('stores symbol and leverage', () => {
    const handle = new TickerHandle(mockSupabase(), 'SPY', 1);
    expect(handle.symbol).toBe('SPY');
    expect(handle.leverage).toBe(1);
  });

  it('defaults leverage to 1', () => {
    const handle = new TickerHandle(mockSupabase(), 'SPY');
    expect(handle.leverage).toBe(1);
  });

  it('throws on .id before resolution', () => {
    const handle = new TickerHandle(mockSupabase(), 'SPY');
    expect(() => handle.id).toThrow('not yet resolved');
  });
});

function mockSupabaseWithUpsert(row: Record<string, unknown>) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const upsert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ upsert });
  return { from } as unknown as TypedSupabaseClient;
}

describe('TickerHandle.resolve', () => {
  it('upserts and returns the row', async () => {
    const row = { id: 42, symbol: 'SPY', leverage: 1, created_at: '2026-01-01T00:00:00Z' };
    const sb = mockSupabaseWithUpsert(row);
    const handle = new TickerHandle(sb, 'SPY', 1);

    const result = await handle.resolve();

    expect(result).toEqual(row);
    expect(handle.id).toBe(42);
    expect(sb.from).toHaveBeenCalledWith('tickers');
  });

  it('caches the result on subsequent calls', async () => {
    const row = { id: 42, symbol: 'SPY', leverage: 1, created_at: '2026-01-01T00:00:00Z' };
    const sb = mockSupabaseWithUpsert(row);
    const handle = new TickerHandle(sb, 'SPY', 1);

    await handle.resolve();
    await handle.resolve();

    expect(sb.from).toHaveBeenCalledTimes(1);
  });

  it('propagates errors', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS denied' } });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });
    const sb = { from } as unknown as TypedSupabaseClient;

    const handle = new TickerHandle(sb, 'SPY');
    await expect(handle.resolve()).rejects.toEqual({ message: 'RLS denied' });
  });

  it('deduplicates concurrent resolve calls', async () => {
    const row = { id: 42, symbol: 'SPY', leverage: 1, created_at: '2026-01-01T00:00:00Z' };
    const sb = mockSupabaseWithUpsert(row);
    const handle = new TickerHandle(sb, 'SPY', 1);

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);

    expect(r1).toEqual(row);
    expect(r2).toEqual(row);
    expect(sb.from).toHaveBeenCalledTimes(1);
  });
});
