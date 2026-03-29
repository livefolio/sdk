import type { TypedSupabaseClient } from '../types';
import type { Observation, DualPrice, TradingDay, MarketModule } from './types';

export function createMarket(client: TypedSupabaseClient): MarketModule {
  return {
    async getBatchSeries(symbols: string[]): Promise<Record<string, Observation[]>> {
      const { data, error } = await client.functions.invoke('series', { body: { symbols } });
      if (error) throw error;
      return data as Record<string, Observation[]>;
    },

    async getSeries(symbol: string): Promise<Observation[]> {
      const result = await this.getBatchSeries([symbol]);
      return result[symbol];
    },

    async getBatchSeriesFromDb(symbols: string[], startDate: string, endDate: string): Promise<Record<string, Observation[]>> {
      const out: Record<string, Observation[]> = Object.fromEntries(symbols.map((symbol) => [symbol, []]));
      if (symbols.length === 0) return out;

      for (const symbol of symbols) {
        const { data, error } = await client
          .from('daily_observations')
          .select('value, tickers!inner(symbol), trading_days!inner(date, post)')
          .eq('tickers.symbol', symbol)
          .eq('tickers.leverage', 1)
          .gte('trading_days.date', startDate)
          .lte('trading_days.date', endDate)
          .order('trading_days(date)', { ascending: true });

        if (error) throw new Error(`Failed to fetch observations for ${symbol}: ${error.message}`);

        out[symbol] = (data ?? []).map((row: { value: number; trading_days: { date: string; post: string } }) => ({
          timestamp: row.trading_days.post,
          value: Number(row.value),
        }));
      }

      return out;
    },

    async getSeriesFromDb(symbol: string, startDate: string, endDate: string): Promise<Observation[]> {
      const result = await this.getBatchSeriesFromDb([symbol], startDate, endDate);
      return result[symbol];
    },

    async getBatchQuotes(symbols: string[]): Promise<Record<string, Observation>> {
      const { data, error } = await client.functions.invoke('quote', { body: { symbols } });
      if (error) throw error;
      return data as Record<string, Observation>;
    },

    async getQuote(symbol: string): Promise<Observation> {
      const result = await this.getBatchQuotes([symbol]);
      const quote = result[symbol];
      if (quote == null) throw new Error(`No quote available for ${symbol}`);
      return quote;
    },

    async getSignalAndExecutionPrices(symbol: string, date: string): Promise<DualPrice | null> {
      const result = await this.getBatchSignalAndExecutionPrices([symbol], date);
      return result[symbol] ?? null;
    },

    async getBatchSignalAndExecutionPrices(symbols: string[], date: string): Promise<Record<string, DualPrice>> {
      if (symbols.length === 0) return {};

      const { data, error } = await client
        .from('price_observations')
        .select('symbol, price_330pm_et, price_400pm_et')
        .in('symbol', symbols)
        .eq('date', date);

      if (error) throw new Error(`Failed to fetch dual prices: ${error.message}`);

      const result: Record<string, DualPrice> = {};
      for (const row of data ?? []) {
        if (row.price_330pm_et == null || row.price_400pm_et == null) continue;
        result[row.symbol] = {
          signal: Number(row.price_330pm_et),
          execution: Number(row.price_400pm_et),
        };
      }
      return result;
    },

    async getTradingDays(startDate: string, endDate: string): Promise<TradingDay[]> {
      const { data, error } = await client
        .from('trading_days')
        .select('date, overnight, pre, regular, post, close')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) throw new Error(`Failed to fetch trading days: ${error.message}`);

      return (data ?? []).map((row) => ({
        date: row.date,
        open: row.regular,
        close: row.post,
        extended_open: row.overnight,
        extended_close: row.close,
      }));
    },

    async getTradingDay(date: string): Promise<TradingDay | null> {
      const { data: row, error } = await client
        .from('trading_days')
        .select('date, overnight, pre, regular, post, close')
        .eq('date', date)
        .limit(1)
        .maybeSingle();

      if (error || !row) return null;

      return {
        date: row.date,
        open: row.regular,
        close: row.post,
        extended_open: row.overnight,
        extended_close: row.close,
      };
    },
  };
}
