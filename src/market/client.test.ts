import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMarket } from './client';
import type { Observation, DualPrice, TradingDay } from './types';

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

function createMockClient() {
  const mockInvoke = vi.fn();
  const mockMaybeSingle = vi.fn();
  const mockOrder = vi.fn();

  // Chainable query builder
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    order: mockOrder,
    maybeSingle: mockMaybeSingle,
  };

  // order() returns a promise-like with the data (terminal for getTradingDays)
  mockOrder.mockReturnValue(queryBuilder);

  const mockFrom = vi.fn().mockReturnValue(queryBuilder);

  const client = {
    functions: { invoke: mockInvoke },
    from: mockFrom,
  } as any;

  return { client, mockInvoke, mockFrom, queryBuilder, mockMaybeSingle, mockOrder };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SERIES_DATA: Observation[] = [
  { timestamp: '2025-01-10T16:00:00Z', value: 590.25 },
  { timestamp: '2025-01-11T16:00:00Z', value: 592.10 },
  { timestamp: '2025-01-12T16:00:00Z', value: 588.50 },
];


const TRADING_DAY_ROW = {
  date: '2025-01-10',
  overnight: '2025-01-10T04:00:00Z',
  pre: '2025-01-10T07:00:00Z',
  regular: '2025-01-10T09:30:00Z',
  post: '2025-01-10T16:00:00Z',
  close: '2025-01-10T20:00:00Z',
};

const PRICE_OBSERVATION_ROW = {
  symbol: 'SPY',
  date: '2025-01-10',
  price_400pm_et: 590.25,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMarket', () => {
  let mock: ReturnType<typeof createMockClient>;
  let market: ReturnType<typeof createMarket>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockClient();
    market = createMarket(mock.client);
  });

  // -----------------------------------------------------------------------
  // getBatchSeries
  // -----------------------------------------------------------------------

  describe('getBatchSeries', () => {
    it('invokes the series edge function with symbols array', async () => {
      const batchResult = { SPY: SERIES_DATA, QQQ: SERIES_DATA };
      mock.mockInvoke.mockResolvedValue({ data: batchResult, error: null });

      const result = await market.getBatchSeries(['SPY', 'QQQ']);

      expect(mock.mockInvoke).toHaveBeenCalledOnce();
      expect(mock.mockInvoke).toHaveBeenCalledWith('series', {
        body: { symbols: ['SPY', 'QQQ'] },
      });
      expect(result).toEqual(batchResult);
    });

    it('throws on invoke error', async () => {
      const error = new Error('Function invocation failed');
      mock.mockInvoke.mockResolvedValue({ data: null, error });

      await expect(market.getBatchSeries(['SPY'])).rejects.toThrow(
        'Function invocation failed'
      );
    });
  });

  // -----------------------------------------------------------------------
  // getBatchSeriesFromDb
  // -----------------------------------------------------------------------

  describe('getBatchSeriesFromDb', () => {
    it('queries price_observations and groups rows by symbol', async () => {
      mock.mockOrder.mockResolvedValueOnce({
        data: [
          PRICE_OBSERVATION_ROW,
          {
            symbol: 'QQQ',
            date: '2025-01-10',
            price_400pm_et: 480.1,
          },
        ],
        error: null,
      }).mockResolvedValueOnce({
        data: [{ date: '2025-01-10', post: '2025-01-10T16:00:00Z' }],
        error: null,
      });

      const result = await market.getBatchSeriesFromDb(['SPY', 'QQQ'], '2025-01-01', '2025-01-31');

      expect(mock.mockFrom).toHaveBeenCalledWith('price_observations');
      expect(mock.queryBuilder.select).toHaveBeenCalledWith('symbol, date, price_400pm_et');
      expect(mock.mockFrom).toHaveBeenCalledWith('trading_days');
      expect(mock.queryBuilder.in).toHaveBeenCalledWith('symbol', ['SPY', 'QQQ']);
      expect(mock.queryBuilder.gte).toHaveBeenCalledWith('date', '2025-01-01');
      expect(mock.queryBuilder.lte).toHaveBeenCalledWith('date', '2025-01-31');
      expect(result).toEqual({
        SPY: [{ timestamp: '2025-01-10T16:00:00Z', value: 590.25 }],
        QQQ: [{ timestamp: '2025-01-10T16:00:00Z', value: 480.1 }],
      });
    });

    it('derives timestamps from trading_days.post when price rows are backfilled', async () => {
      mock.mockOrder.mockResolvedValueOnce({
        data: [{ ...PRICE_OBSERVATION_ROW }],
        error: null,
      }).mockResolvedValueOnce({
        data: [{ date: '2025-01-10', post: '2025-01-10T21:00:00.000Z' }],
        error: null,
      });

      const result = await market.getBatchSeriesFromDb(['SPY'], '2025-01-01', '2025-01-31');
      expect(result.SPY[0]).toEqual({ timestamp: '2025-01-10T21:00:00.000Z', value: 590.25 });
    });

    it('throws when trading_days.post is missing', async () => {
      mock.mockOrder.mockResolvedValueOnce({
        data: [{ ...PRICE_OBSERVATION_ROW }],
        error: null,
      }).mockResolvedValueOnce({
        data: [],
        error: null,
      });

      await expect(market.getBatchSeriesFromDb(['SPY'], '2025-01-01', '2025-01-31')).rejects.toThrow(
        'Missing trading_days.post for SPY on 2025-01-10',
      );
    });

    it('throws on query error', async () => {
      mock.mockOrder.mockResolvedValueOnce({
        data: null,
        error: { message: 'db down' },
      });

      await expect(market.getBatchSeriesFromDb(['SPY'], '2025-01-01', '2025-01-31')).rejects.toThrow(
        'Failed to fetch price observations: db down',
      );
    });

    it('throws on trading_days query error', async () => {
      mock.mockOrder.mockResolvedValueOnce({
        data: [PRICE_OBSERVATION_ROW],
        error: null,
      }).mockResolvedValueOnce({
        data: null,
        error: { message: 'calendar down' },
      });

      await expect(market.getBatchSeriesFromDb(['SPY'], '2025-01-01', '2025-01-31')).rejects.toThrow(
        'Failed to fetch trading days: calendar down',
      );
    });
  });

  // -----------------------------------------------------------------------
  // getSeries (thin wrapper)
  // -----------------------------------------------------------------------

  describe('getSeries', () => {
    it('delegates to getBatchSeries and extracts the single symbol', async () => {
      mock.mockInvoke.mockResolvedValue({
        data: { SPY: SERIES_DATA },
        error: null,
      });

      const result = await market.getSeries('SPY');

      expect(mock.mockInvoke).toHaveBeenCalledWith('series', {
        body: { symbols: ['SPY'] },
      });
      expect(result).toEqual(SERIES_DATA);
    });
  });

  describe('getSeriesFromDb', () => {
    it('delegates to getBatchSeriesFromDb and extracts symbol rows', async () => {
      mock.mockOrder.mockResolvedValueOnce({
        data: [PRICE_OBSERVATION_ROW],
        error: null,
      }).mockResolvedValueOnce({
        data: [{ date: '2025-01-10', post: '2025-01-10T16:00:00Z' }],
        error: null,
      });

      const result = await market.getSeriesFromDb('SPY', '2025-01-01', '2025-01-31');

      expect(mock.mockFrom).toHaveBeenCalledWith('price_observations');
      expect(result).toEqual([{ timestamp: '2025-01-10T16:00:00Z', value: 590.25 }]);
    });
  });

  // -----------------------------------------------------------------------
  // getBatchQuotes
  // -----------------------------------------------------------------------

  describe('getBatchQuotes', () => {
    it('invokes the quote edge function with symbols array', async () => {
      const batchResult = {
        SPY: { timestamp: '2025-01-12T19:15:00.000Z', value: 590.25 },
        QQQ: { timestamp: '2025-01-12T19:15:00.000Z', value: 480.10 },
      };
      mock.mockInvoke.mockResolvedValue({ data: batchResult, error: null });

      const result = await market.getBatchQuotes(['SPY', 'QQQ']);

      expect(mock.mockInvoke).toHaveBeenCalledOnce();
      expect(mock.mockInvoke).toHaveBeenCalledWith('quote', {
        body: { symbols: ['SPY', 'QQQ'] },
      });
      expect(result).toEqual(batchResult);
    });

    it('throws on invoke error', async () => {
      const error = new Error('Function invocation failed');
      mock.mockInvoke.mockResolvedValue({ data: null, error });

      await expect(market.getBatchQuotes(['SPY'])).rejects.toThrow(
        'Function invocation failed'
      );
    });
  });

  // -----------------------------------------------------------------------
  // getQuote (thin wrapper)
  // -----------------------------------------------------------------------

  describe('getQuote', () => {
    it('delegates to getBatchQuotes and extracts the single observation', async () => {
      const spyQuote: Observation = { timestamp: '2025-01-12T19:15:00.000Z', value: 590.25 };
      mock.mockInvoke.mockResolvedValue({
        data: { SPY: spyQuote },
        error: null,
      });

      const result = await market.getQuote('SPY');

      expect(mock.mockInvoke).toHaveBeenCalledWith('quote', {
        body: { symbols: ['SPY'] },
      });
      expect(result).toEqual(spyQuote);
    });

    it('throws when symbol has no quote', async () => {
      mock.mockInvoke.mockResolvedValue({
        data: {},
        error: null,
      });

      await expect(market.getQuote('INVALID')).rejects.toThrow(
        'No quote available for INVALID'
      );
    });
  });

  // -----------------------------------------------------------------------
  // getSignalAndExecutionPrices / getBatchSignalAndExecutionPrices
  // -----------------------------------------------------------------------

  describe('getBatchSignalAndExecutionPrices', () => {
    it('queries price_observations and returns signal + execution prices', async () => {
      mock.queryBuilder.eq.mockResolvedValueOnce({
        data: [
          { symbol: 'SPY', price_330pm_et: 590.10, price_400pm_et: 590.25 },
          { symbol: 'QQQ', price_330pm_et: 479.80, price_400pm_et: 480.10 },
        ],
        error: null,
      });

      const result = await market.getBatchSignalAndExecutionPrices(['SPY', 'QQQ'], '2025-01-10');

      expect(mock.mockFrom).toHaveBeenCalledWith('price_observations');
      expect(mock.queryBuilder.select).toHaveBeenCalledWith('symbol, price_330pm_et, price_400pm_et');
      expect(mock.queryBuilder.in).toHaveBeenCalledWith('symbol', ['SPY', 'QQQ']);
      expect(mock.queryBuilder.eq).toHaveBeenCalledWith('date', '2025-01-10');
      expect(result).toEqual({
        SPY: { signal: 590.10, execution: 590.25 },
        QQQ: { signal: 479.80, execution: 480.10 },
      } satisfies Record<string, DualPrice>);
    });

    it('returns empty object for empty symbols array', async () => {
      const result = await market.getBatchSignalAndExecutionPrices([], '2025-01-10');
      expect(result).toEqual({});
      expect(mock.mockFrom).not.toHaveBeenCalled();
    });

    it('throws on query error', async () => {
      mock.queryBuilder.eq.mockResolvedValueOnce({
        data: null,
        error: { message: 'db down' },
      });

      await expect(
        market.getBatchSignalAndExecutionPrices(['SPY'], '2025-01-10')
      ).rejects.toThrow('Failed to fetch dual prices: db down');
    });

    it('returns empty object when no rows match', async () => {
      mock.queryBuilder.eq.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await market.getBatchSignalAndExecutionPrices(['INVALID'], '2025-01-10');
      expect(result).toEqual({});
    });
  });

  describe('getSignalAndExecutionPrices', () => {
    it('delegates to getBatchSignalAndExecutionPrices and extracts symbol', async () => {
      mock.queryBuilder.eq.mockResolvedValueOnce({
        data: [{ symbol: 'SPY', price_330pm_et: 590.10, price_400pm_et: 590.25 }],
        error: null,
      });

      const result = await market.getSignalAndExecutionPrices('SPY', '2025-01-10');

      expect(result).toEqual({ signal: 590.10, execution: 590.25 } satisfies DualPrice);
    });

    it('returns null when symbol not found', async () => {
      mock.queryBuilder.eq.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const result = await market.getSignalAndExecutionPrices('INVALID', '2025-01-10');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getTradingDays
  // -----------------------------------------------------------------------

  describe('getTradingDays', () => {
    it('queries trading_days table and maps columns to TradingDay shape', async () => {
      // The terminal call in the chain resolves the promise
      mock.mockOrder.mockResolvedValue({
        data: [TRADING_DAY_ROW],
        error: null,
      });

      const result = await market.getTradingDays('2025-01-01', '2025-01-31');

      expect(mock.mockFrom).toHaveBeenCalledWith('trading_days');
      expect(mock.queryBuilder.select).toHaveBeenCalledWith(
        'date, overnight, pre, regular, post, close'
      );
      expect(mock.queryBuilder.gte).toHaveBeenCalledWith('date', '2025-01-01');
      expect(mock.queryBuilder.lte).toHaveBeenCalledWith('date', '2025-01-31');
      expect(mock.queryBuilder.order).toHaveBeenCalledWith('date', { ascending: true });

      expect(result).toEqual([
        {
          date: '2025-01-10',
          open: '2025-01-10T09:30:00Z',
          close: '2025-01-10T16:00:00Z',
          extended_open: '2025-01-10T04:00:00Z',
          extended_close: '2025-01-10T20:00:00Z',
        },
      ] satisfies TradingDay[]);
    });

    it('throws on query error', async () => {
      mock.mockOrder.mockResolvedValue({
        data: null,
        error: { message: 'connection refused' },
      });

      await expect(
        market.getTradingDays('2025-01-01', '2025-01-31')
      ).rejects.toThrow('Failed to fetch trading days: connection refused');
    });

    it('returns empty array when no data', async () => {
      mock.mockOrder.mockResolvedValue({ data: null, error: null });

      const result = await market.getTradingDays('2025-01-01', '2025-01-31');
      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // getTradingDay
  // -----------------------------------------------------------------------

  describe('getTradingDay', () => {
    it('queries a single trading day and maps columns', async () => {
      mock.mockMaybeSingle.mockResolvedValue({
        data: TRADING_DAY_ROW,
        error: null,
      });

      const result = await market.getTradingDay('2025-01-10');

      expect(mock.mockFrom).toHaveBeenCalledWith('trading_days');
      expect(mock.queryBuilder.eq).toHaveBeenCalledWith('date', '2025-01-10');
      expect(result).toEqual({
        date: '2025-01-10',
        open: '2025-01-10T09:30:00Z',
        close: '2025-01-10T16:00:00Z',
        extended_open: '2025-01-10T04:00:00Z',
        extended_close: '2025-01-10T20:00:00Z',
      } satisfies TradingDay);
    });

    it('returns null when no row found', async () => {
      mock.mockMaybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await market.getTradingDay('2099-01-01');
      expect(result).toBeNull();
    });

    it('returns null on query error', async () => {
      mock.mockMaybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'timeout' },
      });

      const result = await market.getTradingDay('2025-01-10');
      expect(result).toBeNull();
    });
  });
});
