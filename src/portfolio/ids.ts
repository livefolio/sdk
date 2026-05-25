/**
 * Deterministic, process-monotonic id generator for {@link Lot} records.
 *
 * Mirrors the `pos_${n}` scheme used for positions. Lot ids are opaque — do
 * not parse them. Determinism keeps backtests reproducible run-to-run within a
 * process; tests MUST assert lot *structure*, never exact ids.
 */
let _lotCounter = 0;
export function nextLotId(): string {
  return `lot_${++_lotCounter}`;
}
