import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMarket } from './client';
import type { Observation, TradingDay } from './types';

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
  timestamp_400pm_et: '2025-01-10T16:00:00Z',
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
      mock.mockOrder.mockResolvedValue({
        data: [
          PRICE_OBSERVATION_ROW,
          {
            symbol: 'QQQ',
            date: '2025-01-10',
            price_400pm_et: 480.1,
            timestamp_400pm_et: '2025-01-10T16:00:00Z',
          },
        ],
        error: null,
      });

      const result = await market.getBatchSeriesFromDb(['SPY', 'QQQ'], '2025-01-01', '2025-01-31');

      expect(mock.mockFrom).toHaveBeenCalledWith('price_observations');
      expect(mock.queryBuilder.select).toHaveBeenCalledWith('symbol, date, price_400pm_et, timestamp_400pm_et');
      expect(mock.queryBuilder.in).toHaveBeenCalledWith('symbol', ['SPY', 'QQQ']);
      expect(mock.queryBuilder.gte).toHaveBeenCalledWith('date', '2025-01-01');
      expect(mock.queryBuilder.lte).toHaveBeenCalledWith('date', '2025-01-31');
      expect(result).toEqual({
        SPY: [{ timestamp: '2025-01-10T16:00:00Z', value: 590.25 }],
        QQQ: [{ timestamp: '2025-01-10T16:00:00Z', value: 480.1 }],
      });
    });

    it('falls back to synthetic timestamp when timestamp_400pm_et is null', async () => {
      mock.mockOrder.mockResolvedValue({
        data: [{ ...PRICE_OBSERVATION_ROW, timestamp_400pm_et: null }],
        error: null,
      });

      const result = await market.getBatchSeriesFromDb(['SPY'], '2025-01-01', '2025-01-31');
      expect(result.SPY[0]).toEqual({ timestamp: '2025-01-10T21:00:00.000Z', value: 590.25 });
    });

    it('throws on query error', async () => {
      mock.mockOrder.mockResolvedValue({
        data: null,
        error: { message: 'db down' },
      });

      await expect(market.getBatchSeriesFromDb(['SPY'], '2025-01-01', '2025-01-31')).rejects.toThrow(
        'Failed to fetch price observations: db down',
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
      mock.mockOrder.mockResolvedValue({
        data: [PRICE_OBSERVATION_ROW],
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
