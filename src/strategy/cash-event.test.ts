import { describe, it, expectTypeOf } from 'vitest';
import type { CashEvent, RunBacktestOptions } from './run-backtest';

describe('CashEvent type surface', () => {
  it('allows an event with required fields', () => {
    const e: CashEvent = { t: new Date(), delta: 1000 };
    expectTypeOf(e).toMatchTypeOf<CashEvent>();
  });
  it('allows tagging with reason', () => {
    const e: CashEvent = { t: new Date(), delta: -500, reason: 'withdrawal' };
    expectTypeOf(e).toMatchTypeOf<CashEvent>();
  });
  it('threads through RunBacktestOptions', () => {
    expectTypeOf<RunBacktestOptions>().toHaveProperty('cashEvents');
  });
});
