export interface Observation {
  timestamp: string;  // ISO 8601 (trading_day.post for series, yahoo regularMarketTime for quotes)
  value: number;
}

export interface TradingDay {
  date: string;
  open: string;           // ISO 8601
  close: string;
  extended_open: string;
  extended_close: string;
}

export interface MarketModule {
  // Via Edge Function (cache-through: resolve indicator -> check daily_observations -> fetch if missing)
  getSeries(symbol: string): Promise<Observation[]>;
  getBatchSeries(symbols: string[]): Promise<Record<string, Observation[]>>;
  getSeriesFromDb(symbol: string, startDate: string, endDate: string): Promise<Observation[]>;
  getBatchSeriesFromDb(
    symbols: string[],
    startDate: string,
    endDate: string,
  ): Promise<Record<string, Observation[]>>;

  // Real-time quotes via Edge Function (yahoo quote with series fallback)
  getQuote(symbol: string): Promise<Observation>;
  getBatchQuotes(symbols: string[]): Promise<Record<string, Observation>>;

  // Direct Supabase queries (trading calendar is seed data)
  getTradingDays(startDate: string, endDate: string): Promise<TradingDay[]>;
  getTradingDay(date: string): Promise<TradingDay | null>;
}
