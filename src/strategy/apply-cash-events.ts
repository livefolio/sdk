import type { CashEvent } from './run-backtest';

/**
 * Sum the deltas of all events with `t <= sessionT`. Pure.
 *
 * O(n) scan over the full array — suitable for testing a single session in
 * isolation. The `runBacktest` loop does NOT call this; it uses a monotonic
 * cursor over a once-sorted array (O(1) per session). Both MUST apply the same
 * `t <= sessionT` boundary — keep them in sync. See the drain block in
 * `run-backtest.ts` for the cursor pattern (the canonical production path).
 */
export function dueCashFlow(events: readonly CashEvent[], sessionT: Date): number {
  let sum = 0;
  for (const e of events) if (e.t.getTime() <= sessionT.getTime()) sum += e.delta;
  return sum;
}
