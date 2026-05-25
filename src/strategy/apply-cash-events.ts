import type { CashEvent } from './run-backtest';

/** Sum the deltas of all events with `t <= sessionT`. Pure. */
export function dueCashFlow(events: readonly CashEvent[], sessionT: Date): number {
  let sum = 0;
  for (const e of events) if (e.t.getTime() <= sessionT.getTime()) sum += e.delta;
  return sum;
}
