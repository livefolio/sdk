export interface Observation {
  date: string;   // YYYY-MM-DD (from trading_day)
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

  // Direct Supabase queries (trading calendar is seed data)
  getTradingDays(startDate: string, endDate: string): Promise<TradingDay[]>;
  getTradingDay(date: string): Promise<TradingDay | null>;
}
