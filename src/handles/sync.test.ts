import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndicatorHandle } from './indicator.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

// ── Mock providers ───────────────────────────────────────────────────

vi.mock('../providers/yahoo.js', () => ({
  fetchYahoo: vi.fn().mockResolvedValue([
    { date: '2026-03-27', value: 100 },
    { date: '2026-03-28', value: 101 },
  ]),
}));

vi.mock('../providers/fred.js', () => ({
  fetchFred: vi.fn().mockResolvedValue([
    { date: '2026-03-27', value: 4.25 },
    { date: '2026-03-28', value: 4.3 },
  ]),
}));

vi.mock('../providers/mappings.js', () => ({
  getProviderInfo: vi.fn().mockImplementation((type: string, symbol: string | null) => {
    if (type === 'Price') return { provider: 'yahoo', symbol: symbol! };
    if (type === 'T10Y') return { provider: 'fred', seriesId: 'DGS10' };
    if (type === 'Threshold') return { provider: 'none' };
    return { provider: 'none' };
  }),
}));

vi.mock('../computations/index.js', () => ({
  getComputation: vi.fn().mockReturnValue(null),
}));

vi.mock('../computations/calendar.js', () => ({
  computeCalendar: vi.fn().mockReturnValue([]),
}));

// ── Helpers ──────────────────────────────────────────────────────────

const LATEST_CLOSED_DATE = '2026-03-28';

interface MockCallState {
  latestSeriesDate: string | null;
  seriesData: { value: number; trading_days: { date: string } }[];
  upsertedRows: unknown[];
}

/**
 * Build a mock supabase client that dispatches based on table name.
 *
 * The mock needs to handle these tables:
 * - tickers (for TickerHandle.resolve)
 * - indicators (for IndicatorHandle.resolve)
 * - trading_days (for _getLatestClosedTradingDay, _upsertSeries date mapping, value() lookup)
 * - indicators_series (for _getLatestSeriesDate, _querySeriesFromDb, _upsertSeries, value())
 */
function buildMockSupabase(state: MockCallState) {
  const upsertedRows: unknown[] = state.upsertedRows;

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'tickers') {
      return {
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 1, symbol: 'SPY', leverage: 1, created_at: '' },
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === 'indicators') {
      return {
        upsert: vi.fn().mockImplementation((_rows: unknown, _opts?: unknown) => {
          // If called from _upsertSeries this won't happen — indicators upsert is from resolve()
          return {
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 10,
                  type: 'Price',
                  ticker_id: 1,
                  lookback: 0,
                  delay: 0,
                  unit: null,
                  threshold: null,
                  created_at: '',
                },
                error: null,
              }),
            }),
          };
        }),
      };
    }

    if (table === 'trading_days') {
      // This table is queried in multiple ways. Return a chainable object.
      // _getLatestClosedTradingDay: .select('date').lt('close', ...).order(...).limit(1).single()
      // _upsertSeries: .select('id, date').in('date', dates)
      // value(): .select('id').eq('date', ...).single()

      const tdChain: Record<string, ReturnType<typeof vi.fn>> = {};

      tdChain.select = vi.fn().mockImplementation(() => {
        // Return a new chain for this select call
        const selectChain: Record<string, ReturnType<typeof vi.fn>> = {};
        const selectSelf = () => selectChain;

        selectChain.lt = vi.fn(selectSelf);
        selectChain.eq = vi.fn(selectSelf);
        selectChain.gte = vi.fn(selectSelf);
        selectChain.lte = vi.fn(selectSelf);
        selectChain.order = vi.fn(selectSelf);
        selectChain.limit = vi.fn(selectSelf);
        selectChain.in = vi.fn().mockImplementation(() => {
          return Promise.resolve({
            data: [
              { id: 100, date: '2026-03-27' },
              { id: 101, date: '2026-03-28' },
            ],
            error: null,
          });
        });
        // _upsertSeries path: .gte().lte().range() returns trading day mappings
        selectChain.range = vi.fn().mockImplementation(() => {
          return Promise.resolve({
            data: [
              { id: 100, date: '2026-03-27' },
              { id: 101, date: '2026-03-28' },
            ],
            error: null,
          });
        });
        selectChain.single = vi.fn().mockResolvedValue({
          data: { date: LATEST_CLOSED_DATE },
          error: null,
        });

        return selectChain;
      });

      return tdChain;
    }

    if (table === 'indicators_series') {
      // Multiple query patterns:
      // _getLatestSeriesDate: .select('trading_days!inner(date)').eq(...).order(...).limit(1).single()
      // _querySeriesFromDb: .select('value, trading_days!inner(date)').eq(...).order(...)  -> returns list
      // _upsertSeries: .upsert(rows, { onConflict: ... })
      // value(): .select('value').eq(...).eq(...).single()  OR  .select('value').eq(...).order(...).limit(1).single()

      const isChain: Record<string, ReturnType<typeof vi.fn>> = {};

      isChain.upsert = vi.fn().mockImplementation((rows: unknown[]) => {
        upsertedRows.push(...(Array.isArray(rows) ? rows : [rows]));
        return Promise.resolve({ data: null, error: null });
      });

      isChain.select = vi.fn().mockImplementation((selectArg: string) => {
        const chain: Record<string, ReturnType<typeof vi.fn>> = {};
        const self = () => chain;

        chain.eq = vi.fn(self);
        chain.gte = vi.fn(self);
        chain.lte = vi.fn(self);
        chain.order = vi.fn(self);
        chain.limit = vi.fn(self);

        if (selectArg === 'trading_days!inner(date)') {
          // _getLatestSeriesDate path
          chain.single = vi.fn().mockImplementation(() => {
            if (state.latestSeriesDate === null) {
              return Promise.resolve({
                data: null,
                error: { code: 'PGRST116', message: 'No rows' },
              });
            }
            return Promise.resolve({
              data: { trading_days: { date: state.latestSeriesDate } },
              error: null,
            });
          });
        } else if (selectArg === 'value, trading_days!inner(date)') {
          // _querySeriesFromDb path — paginated with .range()
          chain.range = vi.fn().mockImplementation(() => {
            const rangeChain: Record<string, ReturnType<typeof vi.fn>> = {};
            const rangeSelf = () => rangeChain;
            rangeChain.gte = vi.fn(rangeSelf);
            rangeChain.lte = vi.fn(rangeSelf);
            rangeChain.then = vi
              .fn()
              .mockImplementation(
                (resolve: (v: { data: unknown[]; error: null }) => void, reject?: (e: unknown) => void) => {
                  return Promise.resolve({
                    data: state.seriesData,
                    error: null,
                  }).then(resolve, reject);
                },
              );
            return rangeChain;
          });
        } else if (selectArg === 'value') {
          // value() path
          chain.single = vi.fn().mockResolvedValue({
            data: { value: state.seriesData.length > 0 ? state.seriesData[0].value : null },
            error: state.seriesData.length > 0 ? null : { code: 'PGRST116', message: 'No rows' },
          });
        }

        return chain;
      });

      return isChain;
    }

    return {};
  });

  return { from } as unknown as TypedSupabaseClient;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('IndicatorHandle sync', () => {
  let fetchYahooMock: ReturnType<typeof vi.fn>;
  let fetchFredMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const yahoo = await import('../providers/yahoo.js');
    const fred = await import('../providers/fred.js');
    fetchYahooMock = yahoo.fetchYahoo as unknown as ReturnType<typeof vi.fn>;
    fetchFredMock = fred.fetchFred as unknown as ReturnType<typeof vi.fn>;
  });

  it('fetches from Yahoo when Price series is empty', async () => {
    const state: MockCallState = {
      latestSeriesDate: null, // no existing data
      seriesData: [
        { value: 100, trading_days: { date: '2026-03-27' } },
        { value: 101, trading_days: { date: '2026-03-28' } },
      ],
      upsertedRows: [],
    };
    const sb = buildMockSupabase(state);
    const ticker = new TickerHandle(sb, 'SPY');

    const handle = new IndicatorHandle(sb, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const bars = await handle.series();

    expect(fetchYahooMock).toHaveBeenCalledWith('SPY', undefined);
    expect(state.upsertedRows.length).toBeGreaterThan(0);
    expect(bars).toHaveLength(2);
    expect(bars[0].date).toBe('2026-03-27');
  });

  it('applies leverage multiplier to daily returns when ticker has leverage != 1', async () => {
    // Yahoo returns raw prices: 100, 102 (2% return)
    // With leverage=2, the second bar should reflect 4% return: 100 * 1.04 = 104
    fetchYahooMock.mockResolvedValueOnce([
      { date: '2026-03-27', value: 100 },
      { date: '2026-03-28', value: 102 },
    ]);

    const state: MockCallState = {
      latestSeriesDate: null,
      seriesData: [],
      upsertedRows: [],
    };
    const sb = buildMockSupabase(state);
    const ticker = new TickerHandle(sb, 'SPY', 2);

    const handle = new IndicatorHandle(sb, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.series();

    expect(state.upsertedRows).toHaveLength(2);

    const values = state.upsertedRows.map((r: unknown) => (r as { value: number }).value);
    // First bar unchanged
    expect(values[0]).toBeCloseTo(100, 5);
    // Second bar: 100 * (1 + 2 * 0.02) = 104
    expect(values[1]).toBeCloseTo(104, 5);
  });

  it('does not apply leverage when leverage is 1', async () => {
    fetchYahooMock.mockResolvedValueOnce([
      { date: '2026-03-27', value: 100 },
      { date: '2026-03-28', value: 102 },
    ]);

    const state: MockCallState = {
      latestSeriesDate: null,
      seriesData: [],
      upsertedRows: [],
    };
    const sb = buildMockSupabase(state);
    const ticker = new TickerHandle(sb, 'SPY', 1);

    const handle = new IndicatorHandle(sb, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.series();

    const values = state.upsertedRows.map((r: unknown) => (r as { value: number }).value);
    expect(values[0]).toBeCloseTo(100, 5);
    expect(values[1]).toBeCloseTo(102, 5);
  });

  it('fetches from FRED for treasury indicators', async () => {
    // Override getProviderInfo for this test
    const mappings = await import('../providers/mappings.js');
    const getProviderInfoMock = mappings.getProviderInfo as unknown as ReturnType<typeof vi.fn>;
    getProviderInfoMock.mockReturnValue({ provider: 'fred', seriesId: 'DGS10' });

    const state: MockCallState = {
      latestSeriesDate: null,
      seriesData: [
        { value: 4.25, trading_days: { date: '2026-03-27' } },
        { value: 4.3, trading_days: { date: '2026-03-28' } },
      ],
      upsertedRows: [],
    };
    const sb = buildMockSupabase(state);

    const handle = new IndicatorHandle(
      sb,
      {
        type: 'T10Y',
        ticker: null,
        lookback: 0,
        delay: 0,
        unit: null,
        threshold: null,
      },
      { fredApiKey: 'test-key' },
    );

    const bars = await handle.series();

    expect(fetchFredMock).toHaveBeenCalledWith('DGS10', 'test-key', undefined);
    expect(state.upsertedRows.length).toBeGreaterThan(0);
    expect(bars).toHaveLength(2);
  });

  it('throws when treasury has no FRED API key', async () => {
    const mappings = await import('../providers/mappings.js');
    const getProviderInfoMock = mappings.getProviderInfo as unknown as ReturnType<typeof vi.fn>;
    getProviderInfoMock.mockReturnValue({ provider: 'fred', seriesId: 'DGS10' });

    const state: MockCallState = {
      latestSeriesDate: null,
      seriesData: [],
      upsertedRows: [],
    };
    const sb = buildMockSupabase(state);

    const handle = new IndicatorHandle(sb, {
      type: 'T10Y',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await expect(handle.series()).rejects.toThrow('FRED API key required');
  });

  it('skips sync when series is already fresh', async () => {
    const state: MockCallState = {
      latestSeriesDate: LATEST_CLOSED_DATE, // already up to date
      seriesData: [
        { value: 100, trading_days: { date: '2026-03-27' } },
        { value: 101, trading_days: { date: '2026-03-28' } },
      ],
      upsertedRows: [],
    };
    const sb = buildMockSupabase(state);
    const ticker = new TickerHandle(sb, 'SPY');

    const handle = new IndicatorHandle(sb, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.series();

    // Should NOT have called fetchYahoo since DB is already fresh
    expect(fetchYahooMock).not.toHaveBeenCalled();
    expect(state.upsertedRows).toHaveLength(0);
  });

  it('caches series in memory on subsequent calls', async () => {
    const state: MockCallState = {
      latestSeriesDate: LATEST_CLOSED_DATE,
      seriesData: [
        { value: 100, trading_days: { date: '2026-03-27' } },
        { value: 101, trading_days: { date: '2026-03-28' } },
      ],
      upsertedRows: [],
    };
    const sb = buildMockSupabase(state);
    const ticker = new TickerHandle(sb, 'SPY');

    const handle = new IndicatorHandle(sb, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const bars1 = await handle.series();
    const bars2 = await handle.series();

    // Should be the exact same reference (cached)
    expect(bars1).toBe(bars2);
  });

  it('paginates _querySeriesFromDb when results exceed 1000 rows', async () => {
    // Build 1500 bars to simulate multi-page response
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      value: i,
      trading_days: {
        date: `2020-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      },
    }));
    const page2 = Array.from({ length: 500 }, (_, i) => ({
      value: 1000 + i,
      trading_days: {
        date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      },
    }));

    let rangeCallCount = 0;

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 1, symbol: 'SPY', leverage: 1, created_at: '' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'indicators') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 10,
                  type: 'Price',
                  ticker_id: 1,
                  lookback: 0,
                  delay: 0,
                  unit: null,
                  threshold: null,
                  created_at: '',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'trading_days') {
        const tdChain: Record<string, ReturnType<typeof vi.fn>> = {};
        tdChain.select = vi.fn().mockImplementation(() => {
          const selectChain: Record<string, ReturnType<typeof vi.fn>> = {};
          const selectSelf = () => selectChain;
          selectChain.lt = vi.fn(selectSelf);
          selectChain.order = vi.fn(selectSelf);
          selectChain.limit = vi.fn(selectSelf);
          selectChain.single = vi.fn().mockResolvedValue({ data: { date: LATEST_CLOSED_DATE }, error: null });
          return selectChain;
        });
        return tdChain;
      }
      if (table === 'indicators_series') {
        const isChain: Record<string, ReturnType<typeof vi.fn>> = {};
        isChain.select = vi.fn().mockImplementation((selectArg: string) => {
          const chain: Record<string, ReturnType<typeof vi.fn>> = {};
          const self = () => chain;
          chain.eq = vi.fn(self);
          chain.order = vi.fn(self);
          chain.limit = vi.fn(self);

          if (selectArg === 'trading_days!inner(date)') {
            chain.single = vi
              .fn()
              .mockResolvedValue({ data: { trading_days: { date: LATEST_CLOSED_DATE } }, error: null });
          } else if (selectArg === 'value, trading_days!inner(date)') {
            chain.range = vi.fn().mockImplementation(() => {
              const rangeChain: Record<string, ReturnType<typeof vi.fn>> = {};
              const rangeSelf = () => rangeChain;
              rangeChain.gte = vi.fn(rangeSelf);
              rangeChain.lte = vi.fn(rangeSelf);
              rangeChain.then = vi
                .fn()
                .mockImplementation(
                  (resolve: (v: { data: unknown[]; error: null }) => void, reject?: (e: unknown) => void) => {
                    const data = rangeCallCount === 0 ? page1 : page2;
                    rangeCallCount++;
                    return Promise.resolve({ data, error: null }).then(resolve, reject);
                  },
                );
              return rangeChain;
            });
          }
          return chain;
        });
        return isChain;
      }
      return {};
    });

    const sb = { from } as unknown as TypedSupabaseClient;
    const ticker = new TickerHandle(sb, 'SPY');
    const handle = new IndicatorHandle(sb, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const bars = await handle.series();
    expect(bars).toHaveLength(1500);
    expect(rangeCallCount).toBe(2);
  });

  it('paginates trading days lookup in _upsertSeries for large syncs', async () => {
    // Generate 1500 bars from Yahoo
    const fetchBars = Array.from({ length: 1500 }, (_, i) => ({
      date: `2020-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      value: 100 + i,
    }));

    // Track trading days range calls and upserted rows
    let tdRangeCallCount = 0;
    const upsertedRows: unknown[] = [];

    // Build page1 (1000 trading day rows) and page2 (500)
    const tdPage1 = fetchBars.slice(0, 1000).map((b, i) => ({ id: i + 1, date: b.date }));
    const tdPage2 = fetchBars.slice(1000).map((b, i) => ({ id: 1001 + i, date: b.date }));

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 1, symbol: 'SPY', leverage: 1, created_at: '' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'indicators') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 10,
                  type: 'Price',
                  ticker_id: 1,
                  lookback: 0,
                  delay: 0,
                  unit: null,
                  threshold: null,
                  created_at: '',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'trading_days') {
        const tdChain: Record<string, ReturnType<typeof vi.fn>> = {};
        tdChain.select = vi.fn().mockImplementation(() => {
          const selectChain: Record<string, ReturnType<typeof vi.fn>> = {};
          const selectSelf = () => selectChain;
          selectChain.lt = vi.fn(selectSelf);
          selectChain.eq = vi.fn(selectSelf);
          selectChain.gte = vi.fn(selectSelf);
          selectChain.lte = vi.fn(selectSelf);
          selectChain.order = vi.fn(selectSelf);
          selectChain.limit = vi.fn(selectSelf);
          selectChain.single = vi.fn().mockResolvedValue({ data: { date: LATEST_CLOSED_DATE }, error: null });
          // _upsertSeries: .gte().lte().range()
          selectChain.range = vi.fn().mockImplementation(() => {
            const data = tdRangeCallCount === 0 ? tdPage1 : tdPage2;
            tdRangeCallCount++;
            return Promise.resolve({ data, error: null });
          });
          return selectChain;
        });
        return tdChain;
      }
      if (table === 'indicators_series') {
        const isChain: Record<string, ReturnType<typeof vi.fn>> = {};
        isChain.upsert = vi.fn().mockImplementation((rows: unknown[]) => {
          upsertedRows.push(...(Array.isArray(rows) ? rows : [rows]));
          return Promise.resolve({ data: null, error: null });
        });
        isChain.select = vi.fn().mockImplementation((selectArg: string) => {
          const chain: Record<string, ReturnType<typeof vi.fn>> = {};
          const self = () => chain;
          chain.eq = vi.fn(self);
          chain.order = vi.fn(self);
          chain.limit = vi.fn(self);
          if (selectArg === 'trading_days!inner(date)') {
            // _getLatestSeriesDate: no data yet
            chain.single = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'No rows' } });
          } else if (selectArg === 'value, trading_days!inner(date)') {
            // _querySeriesFromDb after sync
            chain.range = vi.fn().mockImplementation(() => {
              const rangeChain: Record<string, ReturnType<typeof vi.fn>> = {};
              const rangeSelf = () => rangeChain;
              rangeChain.gte = vi.fn(rangeSelf);
              rangeChain.lte = vi.fn(rangeSelf);
              rangeChain.then = vi
                .fn()
                .mockImplementation(
                  (resolve: (v: { data: unknown[]; error: null }) => void, reject?: (e: unknown) => void) => {
                    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
                  },
                );
              return rangeChain;
            });
          }
          return chain;
        });
        return isChain;
      }
      return {};
    });

    const sb = { from } as unknown as TypedSupabaseClient;
    const ticker = new TickerHandle(sb, 'SPY');
    const handle = new IndicatorHandle(
      sb,
      {
        type: 'Price',
        ticker,
        lookback: 0,
        delay: 0,
        unit: null,
        threshold: null,
      },
      { fredApiKey: 'dummy' },
    );

    // Resolve first so _upsertSeries can access the row id
    await handle.resolve();
    // Call _upsertSeries directly to test pagination without provider mocks
    await (handle as unknown as { _upsertSeries: (bars: typeof fetchBars) => Promise<void> })._upsertSeries(fetchBars);

    // Trading days lookup should have been called twice (paginated)
    expect(tdRangeCallCount).toBe(2);
    // All 1500 bars should have been upserted in a single atomic call
    expect(upsertedRows).toHaveLength(1500);
  });
});
