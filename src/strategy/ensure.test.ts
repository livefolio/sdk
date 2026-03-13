import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureStrategy } from './ensure';
import type { StrategyDraft } from './types';
import { hashLivefolioDefinition, deriveLivefolioLinkId } from './livefolio';

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

// ---------------------------------------------------------------------------
// Test draft
// ---------------------------------------------------------------------------

const testDraft: StrategyDraft = {
  linkId: 'draft-link',
  name: 'Test Draft Strategy',
  trading: { frequency: 'Daily' as const, offset: 0 },
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
  allocations: [
    {
      name: 'Aggressive',
      condition: { kind: 'signal' as const, signalName: 'SPY above SMA5' },
      holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
    },
    {
      name: 'Default',
      condition: { kind: 'signal' as const, signalName: 'SPY above SMA5' },
      holdings: [{ ticker: { symbol: 'BND', leverage: 1 }, weight: 100 }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureStrategy', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
  });

  it('compiles rules from draft and returns strategy object', async () => {
    mock.mockRpc.mockResolvedValue({ data: null, error: null });
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 42 }, error: null }),
        }),
      }),
    }));

    const result = await ensureStrategy(mock.client, testDraft);

    expect(result.strategy).toBeDefined();
    expect(result.strategy.name).toBe('Test Draft Strategy');
    expect(result.strategy.trading).toEqual({ frequency: 'Daily', offset: 0 });
    expect(result.strategy.allocations).toHaveLength(2);
    expect(result.strategy.allocations[0].name).toBe('Aggressive');
    expect(result.strategy.signals).toHaveLength(1);
    // Compiled strategy should have resolved Signal references (not signalName)
    expect(result.strategy.allocations[0].allocation.condition.kind).toBe('signal');
    expect('signal' in result.strategy.allocations[0].allocation.condition).toBe(true);
  });

  it('calls upsert_strategy RPC with correct parameters', async () => {
    mock.mockRpc.mockResolvedValue({ data: null, error: null });
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 42 }, error: null }),
        }),
      }),
    }));

    await ensureStrategy(mock.client, testDraft);

    expect(mock.mockRpc).toHaveBeenCalledWith(
      'upsert_strategy',
      expect.objectContaining({
        p_strategy: expect.objectContaining({
          name: 'Test Draft Strategy',
          definition: expect.any(Object),
          definition_hash: expect.any(String),
          link_id: expect.stringContaining('lf-'),
        }),
      }),
    );
  });

  it('returns strategy ID from database', async () => {
    mock.mockRpc.mockResolvedValue({ data: null, error: null });
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 99 }, error: null }),
        }),
      }),
    }));

    const result = await ensureStrategy(mock.client, testDraft);

    expect(result.strategyId).toBe(99);
    expect(result.created).toBe(true);
  });

  it('uses deterministic link_id derived from definition hash', async () => {
    mock.mockRpc.mockResolvedValue({ data: null, error: null });
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 42 }, error: null }),
        }),
      }),
    }));

    await ensureStrategy(mock.client, testDraft);

    const rpcCall = mock.mockRpc.mock.calls[0];
    const pStrategy = rpcCall[1].p_strategy;

    // link_id should be derived from definition_hash
    const expectedLinkId = deriveLivefolioLinkId(pStrategy.definition_hash);
    expect(pStrategy.link_id).toBe(expectedLinkId);
  });

  it('throws when upsert_strategy RPC fails', async () => {
    mock.mockRpc.mockResolvedValue({ data: null, error: { message: 'DB connection lost' } });

    await expect(ensureStrategy(mock.client, testDraft)).rejects.toThrow(
      'Failed to ensure strategy: DB connection lost',
    );
  });

  it('throws when strategy row not found after upsert', async () => {
    mock.mockRpc.mockResolvedValue({ data: null, error: null });
    mock.mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
        }),
      }),
    }));

    await expect(ensureStrategy(mock.client, testDraft)).rejects.toThrow(
      'Strategy row not found after upsert',
    );
  });

  it('throws on invalid draft (compilation error)', async () => {
    const invalidDraft: StrategyDraft = {
      linkId: 'bad',
      name: 'Bad',
      trading: { frequency: 'Daily' as const, offset: 0 },
      signals: [],
      allocations: [],
    };

    await expect(ensureStrategy(mock.client, invalidDraft)).rejects.toThrow(
      'Rule strategy must define at least one signal',
    );
  });
});
