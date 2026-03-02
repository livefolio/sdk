import type { TypedSupabaseClient } from '../types';
import type { Observation, TradingDay, MarketModule } from './types';

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
