import { describe, it, expect, vi } from 'vitest';
import { fetchYahoo } from './yahoo.js';

vi.mock('yahoo-finance2', () => {
  const chart = vi.fn();
  return {
    default: class {
      chart = chart;
    },
    __mockChart: chart,
  };
});

import { __mockChart } from 'yahoo-finance2';
const mockChart = vi.mocked(__mockChart as ReturnType<typeof vi.fn>);

describe('fetchYahoo', () => {
  it('returns DailyBar[] from chart data', async () => {
    mockChart.mockResolvedValue({
      quotes: [
        { date: new Date('2025-01-02'), close: 100.5, open: 99, high: 101, low: 99, volume: 1000 },
        { date: new Date('2025-01-03'), close: 102.0, open: 100, high: 103, low: 100, volume: 1200 },
      ],
    });

    const result = await fetchYahoo('SPY');

    expect(result).toEqual([
      { date: '2025-01-02', value: 100.5 },
      { date: '2025-01-03', value: 102.0 },
    ]);
    expect(mockChart).toHaveBeenCalledWith('SPY', { period1: '1900-01-01' });
  });

  it('passes from date when provided', async () => {
    mockChart.mockResolvedValue({ quotes: [] });
    await fetchYahoo('SPY', '2024-06-01');
    expect(mockChart).toHaveBeenCalledWith('SPY', { period1: '2024-06-01' });
  });

  it('filters out entries with null/undefined close', async () => {
    mockChart.mockResolvedValue({
      quotes: [
        { date: new Date('2025-01-02'), close: 100, open: 99, high: 101, low: 99, volume: 1000 },
        { date: new Date('2025-01-03'), close: null, open: 100, high: 103, low: 100, volume: 0 },
      ],
    });

    const result = await fetchYahoo('SPY');
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2025-01-02');
  });
});
