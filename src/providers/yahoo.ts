import yahooFinance from 'yahoo-finance2';
import type { DailyBar } from '../handles/indicator.js';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export async function fetchYahoo(symbol: string, from?: string): Promise<DailyBar[]> {
  const result = await yahooFinance.historical(symbol, { period1: from ?? '1900-01-01' }, { adjClose: false });

  return result
    .filter((r) => r.close != null)
    .map((r) => ({
      date: formatDate(r.date),
      value: r.close!,
    }));
}
