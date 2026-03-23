import type { TypedSupabaseClient } from '../types';
import type { Observation, TradingDay, MarketModule } from './types';

function requireMarketCloseTimestamp(row: {
  symbol: string;
  date: string;
  timestamp_400pm_et: string | null;
}): string {
  const raw = row.timestamp_400pm_et;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(
      `Missing timestamp_400pm_et for ${row.symbol} on ${row.date}. ` +
      'Price rows without a market-close timestamp cannot be evaluated safely.',
    );
  }

  if (!Number.isFinite(new Date(raw).getTime())) {
    throw new Error(`Invalid timestamp_400pm_et for ${row.symbol} on ${row.date}: ${raw}`);
  }

  return raw;
}

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

      const { data, error } = await client
        .from('price_observations')
        .select('symbol, date, price_400pm_et, timestamp_400pm_et')
        .in('symbol', symbols)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) throw new Error(`Failed to fetch price observations: ${error.message}`);

      for (const row of data ?? []) {
        const symbol = row.symbol;
        if (!out[symbol]) out[symbol] = [];
        out[symbol].push({
          timestamp: requireMarketCloseTimestamp(row),
          value: row.price_400pm_et,
        });
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
