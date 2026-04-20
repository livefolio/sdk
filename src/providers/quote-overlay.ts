import type { MarketProvider } from './market';
import type { DailyBar } from '../handles/indicator';

export interface OverlayOptions {
  /**
   * When a given date in `overridesByDate` has no entry for the requested
   * symbol, append a synthetic bar using the last base bar's value.
   * Off by default — callers must opt in.
   */
  fallbackMissingQuotes?: boolean;
}

/**
 * Wraps a `MarketProvider` so that, for the dates listed in `overridesByDate`,
 * `fetchBars(symbol, ...)` returns a series with the corresponding bar either
 * appended (if the date is after the last base bar) or replaced (if it already
 * exists in the base bars).
 *
 * **Leverage invariant:** `MarketProvider.fetchBars` returns *raw* bars. This
 * overlay injects raw values only. Leverage compounding happens downstream in
 * `IndicatorHandle` sync; the overlay is intentionally leverage-agnostic.
 * If that downstream assumption ever changes, the override shape will need to
 * change too.
 */
export function createQuoteOverlay(
  base: MarketProvider,
  overridesByDate: Record<string, Record<string, number>>,
  options: OverlayOptions = {},
): MarketProvider {
  return {
    async fetchBars(symbol: string, from?: string): Promise<DailyBar[]> {
      const bars = await base.fetchBars(symbol, from);
      const dates = Object.keys(overridesByDate).sort();
      if (dates.length === 0) return bars;

      const result = [...bars];
      for (const date of dates) {
        const overrideValue = overridesByDate[date]![symbol];
        let value: number | undefined = overrideValue;
        if (value === undefined) {
          if (!options.fallbackMissingQuotes) continue;
          if (result.length === 0) continue;
          value = result[result.length - 1]!.value;
        }
        const existingIdx = result.findIndex((b) => b.date === date);
        if (existingIdx >= 0) {
          result[existingIdx] = { date, value };
        } else {
          result.push({ date, value });
        }
      }
      return result;
    },
  };
}
