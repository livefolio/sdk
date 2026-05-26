/**
 * Result of a single {@link accrueCashInterest} call: the updated cash balance
 * and the interest earned in that session.
 */
export type CashInterestResult = {
  /** Cash balance after interest has been credited: `cash + interest`. */
  newCash: number;
  /** Interest earned in this session: `cash * dailyRate`. */
  interest: number;
};

/**
 * Pure per-session interest accrual using the actual/365 day-count convention.
 *
 * Computes simple (non-compounding within a single call) interest for one
 * trading session. To model compounding over multiple sessions, call this
 * function repeatedly, passing the returned `newCash` as `cash` in each
 * subsequent call.
 *
 * `dailyRate` should be `APY / 365` for an actual/365 day-count (e.g.
 * `0.05 / 365` for a 5% APY). A daily rate of `0` returns the original cash
 * balance with zero interest.
 *
 * @param cash - The current cash balance before interest is applied.
 * @param dailyRate - The per-session interest rate expressed as a decimal
 *   fraction (e.g. `0.05 / 365` for 5% APY on an actual/365 basis).
 * @returns A {@link CashInterestResult} with `newCash` (updated balance) and
 *   `interest` (amount earned this session).
 *
 * @example
 * ```ts
 * // Single session at 5% APY
 * const { newCash, interest } = accrueCashInterest(10_000, 0.05 / 365);
 * ```
 */
export function accrueCashInterest(cash: number, dailyRate: number): CashInterestResult {
  const interest = cash * dailyRate;
  return { newCash: cash + interest, interest };
}
