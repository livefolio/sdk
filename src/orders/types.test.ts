import { describe, it, expectTypeOf } from 'vitest';
import type { Fill } from './types';

describe('Fill.lotId', () => {
  it('is optional', () => {
    const a: Fill = { orderRef: 'o1', t: new Date(), quantity: 1, price: 10, fees: 0 };
    const b: Fill = { orderRef: 'o1', t: new Date(), quantity: 1, price: 10, fees: 0, lotId: 'lot_1' };
    expectTypeOf(a).toMatchTypeOf<Fill>();
    expectTypeOf(b).toMatchTypeOf<Fill>();
  });
});
