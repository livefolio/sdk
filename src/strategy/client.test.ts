import { describe, it, expect, vi } from 'vitest';
import { createStrategy } from './client';

describe('createStrategy', () => {
  it('returns a module with all expected methods', () => {
    const client = {
      from: vi.fn(),
      rpc: vi.fn(),
      functions: { invoke: vi.fn() },
    } as any;

    const mod = createStrategy(client);

    expect(typeof mod.get).toBe('function');
    expect(typeof mod.getMany).toBe('function');
    expect(typeof mod.evaluate).toBe('function');
    expect(typeof mod.evaluateIndicator).toBe('function');
    expect(typeof mod.evaluateSignal).toBe('function');
    expect(typeof mod.evaluateAllocation).toBe('function');
    expect(typeof mod.getEvaluationDate).toBe('function');
    expect(typeof mod.extractSymbols).toBe('function');
    expect(typeof mod.createStreamer).toBe('function');
    expect(typeof mod.backtest).toBe('function');
  });

  it('delegates get to the get module', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({ data: { linkId: 'x' }, error: null });
    const client = {
      from: vi.fn(),
      rpc: vi.fn(),
      functions: { invoke: mockInvoke },
    } as any;

    const mod = createStrategy(client);
    const result = await mod.get('x');

    expect(mockInvoke).toHaveBeenCalledWith('strategy', { body: { linkId: 'x' } });
    expect(result).toEqual({ linkId: 'x' });
  });

  it('delegates backtest to the backtest module', async () => {
    const client = {
      from: vi.fn(),
      rpc: vi.fn(),
      functions: { invoke: vi.fn() },
    } as any;

    const mod = createStrategy(client);

    await expect(
      mod.backtest(
        { linkId: 'x', name: 'x', trading: { frequency: 'Daily', offset: 0 }, allocations: [], signals: [] },
        { startDate: '2020-01-01', endDate: '2025-01-01' },
      ),
    ).rejects.toThrow('Not implemented');
  });
});
