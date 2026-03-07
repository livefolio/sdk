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
    expect(typeof mod.stream).toBe('function');
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
    const mockInvoke = vi.fn().mockResolvedValue({
      data: {
        SPY: [{ timestamp: '2024-01-02T21:00:00.000Z', value: 100 }],
      },
      error: null,
    });
    const mockOrder = vi.fn().mockResolvedValue({
      data: [
        {
          date: '2024-01-02',
          overnight: '2024-01-02T09:00:00.000Z',
          pre: '2024-01-02T13:00:00.000Z',
          regular: '2024-01-02T14:30:00.000Z',
          post: '2024-01-02T21:00:00.000Z',
          close: '2024-01-02T22:00:00.000Z',
        },
      ],
      error: null,
    });
    const mockLte = vi.fn(() => ({ order: mockOrder }));
    const mockGte = vi.fn(() => ({ lte: mockLte }));
    const mockSelect = vi.fn(() => ({ gte: mockGte }));
    const mockFrom = vi.fn(() => ({ select: mockSelect }));
    const client = {
      from: mockFrom,
      rpc: vi.fn(),
      functions: { invoke: mockInvoke },
    } as any;

    const mod = createStrategy(client);

    const result = await mod.backtest(
      {
        linkId: 'x',
        name: 'x',
        trading: { frequency: 'Daily', offset: 0 },
        allocations: [
          {
            name: 'Default',
            allocation: {
              condition: { kind: 'and', args: [] },
              holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
            },
          },
        ],
        signals: [],
      },
      { startDate: '2024-01-02', endDate: '2024-01-02' },
    );

    expect(mockInvoke).toHaveBeenCalledWith('series', { body: { symbols: ['SPY'] } });
    expect(mockFrom).toHaveBeenCalledWith('trading_days');
    expect(result.summary.tradeCount).toBe(1);
  });
});
