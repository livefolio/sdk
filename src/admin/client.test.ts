import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdmin } from './client';
import type { Strategy, StrategyEvaluation } from '../strategy/types';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockClient() {
  const mockRpc = vi.fn();
  const mockFrom = vi.fn();
  const client = {
    from: mockFrom,
    rpc: mockRpc,
  } as any;
  return { client, mockFrom, mockRpc };
}

const testStrategy: Strategy = {
  linkId: 'abc-123',
  name: 'Test Strategy',
  trading: { frequency: 'Daily' as const, offset: 0 },
  allocations: [
    {
      name: 'Aggressive',
      allocation: {
        condition: {
          kind: 'signal' as const,
          signal: {
            left: { type: 'Price' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
            comparison: '>' as const,
            right: { type: 'SMA' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 5, delay: 0, unit: null, threshold: null },
            tolerance: 0,
          },
        },
        holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
      },
    },
  ],
  signals: [
    {
      name: 'SPY above SMA5',
      signal: {
        left: { type: 'Price' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
        comparison: '>' as const,
        right: { type: 'SMA' as const, ticker: { symbol: 'SPY', leverage: 1 }, lookback: 5, delay: 0, unit: null, threshold: null },
        tolerance: 0,
      },
    },
  ],
};

const testEvaluation: StrategyEvaluation = {
  asOf: new Date('2025-01-10T21:00:00.000Z'),
  allocation: { name: 'Aggressive', holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }] },
  signals: { 'Price_SPY_1_>_SMA_SPY_5_t0': true },
  indicators: {
    'Price_SPY_1': { timestamp: '2025-01-10T21:00:00.000Z', value: 104 },
    'SMA_SPY_5': { timestamp: '2025-01-10T21:00:00.000Z', value: 102 },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createAdmin', () => {
  let mock: ReturnType<typeof createMockClient>;
  let adminModule: ReturnType<typeof createAdmin>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
    adminModule = createAdmin(mock.client);
  });

  describe('upsertEvaluation', () => {
    it('calls upsert_evaluation RPC with signal names and indicator results', async () => {
      mock.mockRpc.mockResolvedValue({ error: null });
      mock.mockFrom.mockImplementation((table: string) => {
        if (table === 'strategies') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 1 }, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'named_signals') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  {
                    signals: {
                      indicator_1: { id: 10, type: 'Price', tickers: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
                      indicator_2: { id: 11, type: 'SMA', tickers: { symbol: 'SPY', leverage: 1 }, lookback: 5, delay: 0, unit: null, threshold: null },
                    },
                  },
                ],
                error: null,
              }),
            }),
          };
        }
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
      });

      await adminModule.upsertEvaluation({
        strategy: testStrategy,
        result: testEvaluation,
        tradingDayId: 500,
      });

      expect(mock.mockRpc).toHaveBeenCalledWith('upsert_evaluation', {
        p_link_id: 'abc-123',
        p_allocation_name: 'Aggressive',
        p_signal_results: [{ name: 'SPY above SMA5', result: true }],
        p_indicator_results: expect.arrayContaining([
          expect.objectContaining({ indicatorId: 10, value: 104 }),
          expect.objectContaining({ indicatorId: 11, value: 102 }),
        ]),
        p_trading_day_id: 500,
      });
    });

    it('throws on RPC error', async () => {
      mock.mockRpc.mockResolvedValue({ error: { message: 'permission denied' } });
      mock.mockFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }));

      await expect(
        adminModule.upsertEvaluation({
          strategy: testStrategy,
          result: testEvaluation,
          tradingDayId: 500,
        })
      ).rejects.toThrow('Failed to store evaluation: permission denied');
    });
  });

  describe('upsertObservations', () => {
    it('calls upsert_observations RPC with ticker and observations', async () => {
      mock.mockRpc.mockResolvedValue({ error: null });

      await adminModule.upsertObservations({
        tickerId: 42,
        observations: [
          { date: '2025-01-10', value: 590.25 },
          { date: '2025-01-11', value: 592.10 },
        ],
      });

      expect(mock.mockRpc).toHaveBeenCalledWith('upsert_observations', {
        p_ticker_id: 42,
        p_observations: [
          { date: '2025-01-10', value: 590.25 },
          { date: '2025-01-11', value: 592.10 },
        ],
      });
    });

    it('throws on RPC error', async () => {
      mock.mockRpc.mockResolvedValue({ error: { message: 'db error' } });

      await expect(
        adminModule.upsertObservations({
          tickerId: 42,
          observations: [{ date: '2025-01-10', value: 590.25 }],
        })
      ).rejects.toThrow('Failed to upsert observations: db error');
    });
  });
});
