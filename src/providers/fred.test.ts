import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFred } from './fred.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchFred', () => {
  it('returns DailyBar[] from FRED observations', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          observations: [
            { date: '2025-01-02', value: '4.25' },
            { date: '2025-01-03', value: '4.30' },
          ],
        }),
    });

    const result = await fetchFred('DGS10', 'test-key');

    expect(result).toEqual([
      { date: '2025-01-02', value: 4.25 },
      { date: '2025-01-03', value: 4.3 },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('series_id=DGS10'));
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('api_key=test-key'));
  });

  it('filters out missing values (FRED uses "." for missing)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          observations: [
            { date: '2025-01-02', value: '4.25' },
            { date: '2025-01-03', value: '.' },
          ],
        }),
    });

    const result = await fetchFred('DGS10', 'test-key');
    expect(result).toHaveLength(1);
  });

  it('passes observation_start when from is provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ observations: [] }),
    });

    await fetchFred('DGS10', 'test-key', '2024-06-01');

    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('observation_start=2024-06-01'));
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(fetchFred('DGS10', 'bad-key')).rejects.toThrow('FRED API error: 401 Unauthorized');
  });
});
