import { describe, it, expect, vi } from 'vitest';
import { fetchYahoo } from './yahoo.js';

vi.mock('yahoo-finance2', () => ({
  default: {
    historical: vi.fn(),
  },
}));

import yahooFinance from 'yahoo-finance2';
const mockHistorical = vi.mocked(yahooFinance.historical);

type HistoricalResult = Awaited<ReturnType<typeof mockHistorical>>;

describe('fetchYahoo', () => {
  it('returns DailyBar[] from historical data', async () => {
    mockHistorical.mockResolvedValue([
      { date: new Date('2025-01-02'), close: 100.5, open: 99, high: 101, low: 99, volume: 1000, adjClose: 100.5 },
      { date: new Date('2025-01-03'), close: 102.0, open: 100, high: 103, low: 100, volume: 1200, adjClose: 102.0 },
    ] as unknown as HistoricalResult);

    const result = await fetchYahoo('SPY');

    expect(result).toEqual([
      { date: '2025-01-02', value: 100.5 },
      { date: '2025-01-03', value: 102.0 },
    ]);
    expect(mockHistorical).toHaveBeenCalledWith('SPY', { period1: '1900-01-01' }, { adjClose: false });
  });

  it('passes from date when provided', async () => {
    mockHistorical.mockResolvedValue([] as unknown as HistoricalResult);
    await fetchYahoo('SPY', '2024-06-01');
    expect(mockHistorical).toHaveBeenCalledWith('SPY', { period1: '2024-06-01' }, { adjClose: false });
  });

  it('filters out entries with null/undefined close', async () => {
    mockHistorical.mockResolvedValue([
      { date: new Date('2025-01-02'), close: 100, open: 99, high: 101, low: 99, volume: 1000, adjClose: 100 },
      { date: new Date('2025-01-03'), close: null, open: 100, high: 103, low: 100, volume: 0, adjClose: null },
    ] as unknown as HistoricalResult);

    const result = await fetchYahoo('SPY');
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2025-01-02');
  });
});
