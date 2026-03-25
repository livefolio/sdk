export interface Observation {
  timestamp: string;  // ISO 8601 (trading_day.post for series, yahoo regularMarketTime for quotes)
  value: number;
  signalValue?: number;  // Signal-time price (3:30PM/12:30PM) when dual-price is needed
}

export interface DualPrice {
  signal: number;     // 3:30PM ET (12:30PM on half-days) — for evaluation
  execution: number;  // 4:00PM ET (1:00PM on half-days) — for order execution
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

  // Dual-price queries (signal + execution prices from price_observations)
  getSignalAndExecutionPrices(symbol: string, date: string): Promise<DualPrice | null>;
  getBatchSignalAndExecutionPrices(symbols: string[], date: string): Promise<Record<string, DualPrice>>;

  // Direct Supabase queries (trading calendar is seed data)
  getTradingDays(startDate: string, endDate: string): Promise<TradingDay[]>;
  getTradingDay(date: string): Promise<TradingDay | null>;
}
