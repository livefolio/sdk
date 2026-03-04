import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get, getMany } from './get';

function createMockClient() {
  const mockInvoke = vi.fn();
  const client = { functions: { invoke: mockInvoke } } as any;
  return { client, mockInvoke };
}

const STRATEGY_RESPONSE = {
  linkId: 'abc-123',
  name: 'Test Strategy',
  trading: { frequency: 'Daily', offset: 0 },
  signals: [
    {
      name: 'SPY above SMA50',
      signal: {
        left: { type: 'Price', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
        comparison: '>',
        right: { type: 'SMA', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 50, delay: 0, unit: null, threshold: null },
        tolerance: 0,
      },
    },
  ],
  allocations: [
    {
      name: 'Aggressive',
      allocation: {
        condition: {
          kind: 'signal',
          signal: {
            left: { type: 'Price', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 1, delay: 0, unit: null, threshold: null },
            comparison: '>',
            right: { type: 'SMA', ticker: { symbol: 'SPY', leverage: 1 }, lookback: 50, delay: 0, unit: null, threshold: null },
            tolerance: 0,
          },
        },
        holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
      },
    },
  ],
};

describe('get', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
  });

  it('returns strategy from edge function', async () => {
    mock.mockInvoke.mockResolvedValue({ data: STRATEGY_RESPONSE, error: null });

    const result = await get(mock.client, 'abc-123');

    expect(result).not.toBeNull();
    expect(result!.linkId).toBe('abc-123');
    expect(result!.name).toBe('Test Strategy');
    expect(result!.trading).toEqual({ frequency: 'Daily', offset: 0 });
    expect(result!.signals).toHaveLength(1);
    expect(result!.allocations).toHaveLength(1);
  });

  it('calls invoke with correct args', async () => {
    mock.mockInvoke.mockResolvedValue({ data: STRATEGY_RESPONSE, error: null });

    await get(mock.client, 'abc-123');

    expect(mock.mockInvoke).toHaveBeenCalledWith('strategy', {
      body: { linkId: 'abc-123' },
    });
  });

  it('returns null when strategy not found', async () => {
    mock.mockInvoke.mockResolvedValue({ data: null, error: null });
    expect(await get(mock.client, 'nonexistent')).toBeNull();
  });

  it('returns null on invoke error', async () => {
    mock.mockInvoke.mockResolvedValue({ data: null, error: new Error('edge function error') });
    expect(await get(mock.client, 'abc-123')).toBeNull();
  });
});

describe('getMany', () => {
  let mock: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
  });

  it('returns empty record for empty input', async () => {
    expect(await getMany(mock.client, [])).toEqual({});
  });

  it('returns strategies keyed by linkId', async () => {
    mock.mockInvoke.mockResolvedValue({ data: STRATEGY_RESPONSE, error: null });

    const result = await getMany(mock.client, ['abc-123']);
    expect(Object.keys(result)).toEqual(['abc-123']);
    expect(result['abc-123'].name).toBe('Test Strategy');
  });

  it('skips strategies that return null', async () => {
    mock.mockInvoke.mockResolvedValue({ data: null, error: null });
    expect(await getMany(mock.client, ['nonexistent'])).toEqual({});
  });
});
