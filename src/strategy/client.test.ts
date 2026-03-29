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
    expect(typeof mod.compileRules).toBe('function');
    expect(typeof mod.backtestRules).toBe('function');
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
    const mockInvoke = vi.fn();
    const mockOrder = vi.fn();
    const mockLte = vi.fn(() => ({ order: mockOrder }));
    const mockGte = vi.fn(() => ({ lte: mockLte }));
    const mockEq = vi.fn(() => ({ eq: mockEq, gte: mockGte }));
    const mockSelect = vi.fn(() => ({ eq: mockEq, gte: mockGte }));
    const mockFrom = vi.fn((table: string) => {
      if (table === 'daily_observations') {
        mockOrder.mockResolvedValueOnce({
          data: [
            {
              value: 100,
              tickers: { symbol: 'SPY' },
              trading_days: { date: '2024-01-02', post: '2024-01-02T21:00:00.000Z' },
            },
          ],
          error: null,
        });
      }
      if (table === 'trading_days') {
        mockOrder.mockResolvedValueOnce({
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
      }
      return { select: mockSelect };
    });
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
        allocations: {
          Default: {
            condition: { kind: 'and', args: [] },
            holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
          },
        },
        signals: {},
      },
      { startDate: '2024-01-02', endDate: '2024-01-02' },
    );

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith('daily_observations');
    expect(mockFrom).toHaveBeenCalledWith('trading_days');
    expect(result.summary.tradeCount).toBe(1);
  });
});
