import YahooFinance from 'yahoo-finance2';
import type { DailyBar } from '../handles/indicator.js';

const yf = new YahooFinance({ suppressNotices: ['ripHistorical'] });

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export async function fetchYahoo(symbol: string, from?: string): Promise<DailyBar[]> {
  const result = await yf.chart(symbol, { period1: from ?? '1900-01-01' });

  return result.quotes
    .filter((r) => r.close != null)
    .map((r) => ({
      date: formatDate(r.date),
      value: r.close!,
    }));
}
