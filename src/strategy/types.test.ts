import { describe, it, expectTypeOf } from 'vitest';
import type { Strategy, Features } from './types';
import type { Order } from '../orders/types';

describe('Strategy<F, S>', () => {
  it('compiles with no state arg (backward compat: S defaults to void)', () => {
    type F = { x: number } & Features;
    const s: Strategy<F> = {
      universe: () => [],
      features: async () => ({ x: 1 }),
      build: () => [],
    };
    expectTypeOf(s.build).returns.toEqualTypeOf<ReadonlyArray<Order>>();
  });

  it('compiles with an explicit state type', () => {
    type F = { x: number } & Features;
    type S = { lastSeen: number };
    const s: Strategy<F, S> = {
      universe: () => [],
      features: async () => ({ x: 1 }),
      initialState: () => ({ lastSeen: 0 }),
      build: (features, _portfolio, state, _t) => ({
        orders: [],
        state: { lastSeen: features.x + state.lastSeen },
      }),
    };
    expectTypeOf(s.initialState!).returns.toEqualTypeOf<S>();
  });
});
