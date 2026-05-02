import type { StrategyBar } from '@livefolio/sdk';
import type { BacktestResult } from '@livefolio/sdk/strategy';

export type AllocationDay = {
  readonly date: string; // 'YYYY-MM-DD' (UTC)
  readonly weights: Readonly<Record<string, number>>;
};

export type AllocationHistory = ReadonlyArray<AllocationDay>;

export type SymbolToAssetId = (symbol: string) => string;

const defaultMapper: SymbolToAssetId = (s) => `us:${s}`;

/**
 * Extract per-day target weights from a v0.3 StrategyBar[]. Reads
 * `bar.allocation.holdings` (a `[TickerHandle, number][]`). Drops CASHX.
 * Renormalizes the remaining weights to sum to 1.0 (defensive — v0.3
 * allocations are typically already normalized excluding cash).
 *
 * Caller obtains bars via `await strategy.series({ from, to })`.
 */
export function extractV3History(
  bars: ReadonlyArray<StrategyBar>,
  symbolToAssetId: SymbolToAssetId = defaultMapper,
): AllocationHistory {
  const out: AllocationDay[] = [];
  for (const bar of bars) {
    const weights: Record<string, number> = {};
    let total = 0;
    for (const [ticker, w] of bar.allocation.holdings) {
      if (ticker.symbol === 'CASHX') continue;
      const id = symbolToAssetId(ticker.symbol);
      weights[id] = (weights[id] ?? 0) + w;
      total += w;
    }
    if (total > 0 && Math.abs(total - 1) > 1e-9) {
      for (const k of Object.keys(weights)) weights[k] = weights[k]! / total;
    }
    out.push({ date: bar.date, weights });
  }
  return out;
}

/**
 * Extract per-day target weights from a v0.4 BacktestResult. For each snapshot,
 * computes value of each position at `priceAt(assetId, date)` and divides by
 * total non-cash value. Cash is excluded (residual goes to "no weight").
 */
export function extractV4History(
  result: BacktestResult,
  priceAt: (assetId: string, date: string) => number,
): AllocationHistory {
  const out: AllocationDay[] = [];
  for (const snap of result.snapshots) {
    const date = snap.t.toISOString().slice(0, 10);
    const values: Record<string, number> = {};
    let total = 0;
    for (const pos of snap.portfolio.positions) {
      const px = priceAt(pos.asset.id, date);
      const v = pos.quantity * px;
      values[pos.asset.id] = (values[pos.asset.id] ?? 0) + v;
      total += v;
    }
    const weights: Record<string, number> = {};
    if (total > 0) {
      for (const [k, v] of Object.entries(values)) weights[k] = v / total;
    }
    out.push({ date, weights });
  }
  return out;
}
