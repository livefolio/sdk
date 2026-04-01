# Portfolio Handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `PortfolioHandle` to the SDK that represents a point-in-time portfolio snapshot and computes concrete trades to reach a target allocation.

**Architecture:** `PortfolioHandle` is a lightweight, non-persisted handle (no Supabase) that holds `[TickerHandle, quantity][]` tuples. It provides `value()`, `weights()`, and `trades()` methods. `trades()` reuses the existing `Trade` type from `backtest/types.ts` and outputs sells before buys.

**Tech Stack:** TypeScript, Vitest, existing SDK handle pattern

**Spec:** `docs/superpowers/specs/2026-03-31-portfolio-handle-design.md`

---

### Task 1: PortfolioHandle — constructor and validation tests

**Files:**
- Create: `sdk/src/handles/portfolio.test.ts`
- Create: `sdk/src/handles/portfolio.ts`

- [ ] **Step 1: Write the failing tests for construction and validation**

```ts
// sdk/src/handles/portfolio.test.ts
import { describe, it, expect } from 'vitest';
import { PortfolioHandle } from './portfolio.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

function mockSupabase() {
  return {} as TypedSupabaseClient;
}

describe('PortfolioHandle construction', () => {
  it('stores holdings as ticker-quantity pairs', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const cashx = new TickerHandle(sb, 'CASHX');
    const handle = new PortfolioHandle([[spy, 500], [cashx, 5000]]);

    expect(handle.holdings).toHaveLength(2);
    expect(handle.holdings[0][0]).toBe(spy);
    expect(handle.holdings[0][1]).toBe(500);
    expect(handle.holdings[1][0]).toBe(cashx);
    expect(handle.holdings[1][1]).toBe(5000);
  });

  it('throws on duplicate tickers', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    expect(
      () => new PortfolioHandle([[spy, 500], [spy, 200]]),
    ).toThrow('Duplicate ticker');
  });

  it('throws on negative quantities', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    expect(
      () => new PortfolioHandle([[spy, -100]]),
    ).toThrow('negative');
  });

  it('accepts zero-quantity holdings', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    expect(
      () => new PortfolioHandle([[spy, 0]]),
    ).not.toThrow();
  });

  it('accepts empty holdings', () => {
    expect(
      () => new PortfolioHandle([]),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts`
Expected: FAIL — `Cannot find module './portfolio.js'`

- [ ] **Step 3: Write minimal PortfolioHandle class**

```ts
// sdk/src/handles/portfolio.ts
import { TickerHandle } from './ticker.js';

export class PortfolioHandle {
  readonly holdings: [TickerHandle, number][];

  constructor(holdings: [TickerHandle, number][]) {
    // Check for duplicates
    const seen = new Set<string>();
    for (const [ticker, quantity] of holdings) {
      const key = `${ticker.symbol}:${ticker.leverage}`;
      if (seen.has(key)) {
        throw new Error(`Duplicate ticker: ${ticker.symbol}`);
      }
      seen.add(key);

      if (quantity < 0) {
        throw new Error(`Quantity for ${ticker.symbol} is negative: ${quantity}`);
      }
    }

    this.holdings = holdings;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sdk/src/handles/portfolio.ts sdk/src/handles/portfolio.test.ts
git commit -m "feat(sdk): add PortfolioHandle with constructor and validation"
```

---

### Task 2: `value()` method

**Files:**
- Modify: `sdk/src/handles/portfolio.test.ts`
- Modify: `sdk/src/handles/portfolio.ts`

- [ ] **Step 1: Write failing tests for value()**

Append to `sdk/src/handles/portfolio.test.ts`:

```ts
describe('PortfolioHandle.value', () => {
  it('computes total portfolio value from positions and prices', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([[spy, 500], [bnd, 200], [cashx, 5000]]);

    const prices: [TickerHandle, number][] = [[spy, 520.50], [bnd, 72.30]];
    // 500 * 520.50 + 200 * 72.30 + 5000 * 1.0 = 260250 + 14460 + 5000 = 279710
    expect(portfolio.value(prices)).toBeCloseTo(279710, 2);
  });

  it('treats CASHX price as 1.0 even if provided in prices', () => {
    const sb = mockSupabase();
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([[cashx, 10000]]);

    // Provide a bogus CASHX price — should be ignored
    const prices: [TickerHandle, number][] = [[cashx, 999]];
    expect(portfolio.value(prices)).toBeCloseTo(10000, 2);
  });

  it('throws if a non-CASHX ticker is missing from prices', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const portfolio = new PortfolioHandle([[spy, 500]]);

    expect(() => portfolio.value([])).toThrow('Missing price for SPY');
  });

  it('returns 0 for empty portfolio', () => {
    const portfolio = new PortfolioHandle([]);
    expect(portfolio.value([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts`
Expected: FAIL — `portfolio.value is not a function`

- [ ] **Step 3: Implement value()**

Add to `PortfolioHandle` in `sdk/src/handles/portfolio.ts`:

```ts
  private _priceMap(prices: [TickerHandle, number][]): Map<string, number> {
    const map = new Map<string, number>();
    for (const [ticker, price] of prices) {
      map.set(`${ticker.symbol}:${ticker.leverage}`, price);
    }
    return map;
  }

  private _priceFor(
    ticker: TickerHandle,
    priceMap: Map<string, number>,
  ): number {
    if (ticker.symbol === 'CASHX') return 1;
    const key = `${ticker.symbol}:${ticker.leverage}`;
    const price = priceMap.get(key);
    if (price == null) {
      throw new Error(`Missing price for ${ticker.symbol}`);
    }
    return price;
  }

  value(prices: [TickerHandle, number][]): number {
    const priceMap = this._priceMap(prices);
    let total = 0;
    for (const [ticker, quantity] of this.holdings) {
      total += quantity * this._priceFor(ticker, priceMap);
    }
    return total;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sdk/src/handles/portfolio.ts sdk/src/handles/portfolio.test.ts
git commit -m "feat(sdk): add PortfolioHandle.value() method"
```

---

### Task 3: `weights()` method

**Files:**
- Modify: `sdk/src/handles/portfolio.test.ts`
- Modify: `sdk/src/handles/portfolio.ts`

- [ ] **Step 1: Write failing tests for weights()**

Append to `sdk/src/handles/portfolio.test.ts`:

```ts
describe('PortfolioHandle.weights', () => {
  it('computes allocation weights from positions and prices', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([[spy, 500], [bnd, 200], [cashx, 5000]]);

    const prices: [TickerHandle, number][] = [[spy, 520.50], [bnd, 72.30]];
    const weights = portfolio.weights(prices);

    // Total = 279710
    // SPY: 260250 / 279710 ≈ 0.9304
    // BND: 14460 / 279710 ≈ 0.0517
    // CASHX: 5000 / 279710 ≈ 0.0179
    expect(weights).toHaveLength(3);
    expect(weights[0][0]).toBe(spy);
    expect(weights[0][1]).toBeCloseTo(0.9304, 3);
    expect(weights[1][0]).toBe(bnd);
    expect(weights[1][1]).toBeCloseTo(0.0517, 3);
    expect(weights[2][0]).toBe(cashx);
    expect(weights[2][1]).toBeCloseTo(0.0179, 3);
  });

  it('returns empty array for empty portfolio', () => {
    const portfolio = new PortfolioHandle([]);
    expect(portfolio.weights([])).toEqual([]);
  });

  it('skips zero-quantity holdings', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const portfolio = new PortfolioHandle([[spy, 100], [bnd, 0]]);

    const prices: [TickerHandle, number][] = [[spy, 500], [bnd, 100]];
    const weights = portfolio.weights(prices);

    expect(weights).toHaveLength(1);
    expect(weights[0][0]).toBe(spy);
    expect(weights[0][1]).toBeCloseTo(1.0, 4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts`
Expected: FAIL — `portfolio.weights is not a function`

- [ ] **Step 3: Implement weights()**

Add to `PortfolioHandle` in `sdk/src/handles/portfolio.ts`:

```ts
  weights(prices: [TickerHandle, number][]): [TickerHandle, number][] {
    const total = this.value(prices);
    if (total === 0) return [];

    const priceMap = this._priceMap(prices);
    const result: [TickerHandle, number][] = [];
    for (const [ticker, quantity] of this.holdings) {
      const dollarValue = quantity * this._priceFor(ticker, priceMap);
      if (dollarValue === 0) continue;
      result.push([ticker, dollarValue / total]);
    }
    return result;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sdk/src/handles/portfolio.ts sdk/src/handles/portfolio.test.ts
git commit -m "feat(sdk): add PortfolioHandle.weights() method"
```

---

### Task 4: `trades()` method

**Files:**
- Modify: `sdk/src/handles/portfolio.test.ts`
- Modify: `sdk/src/handles/portfolio.ts`

- [ ] **Step 1: Write failing tests for trades()**

Append to `sdk/src/handles/portfolio.test.ts`. Add the following import at the top of the file:

```ts
import { AllocationHandle } from './allocation.js';
import type { Trade } from '../backtest/types.js';
```

Then append the describe block:

```ts
describe('PortfolioHandle.trades', () => {
  it('computes buy and sell trades to reach target allocation', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([[spy, 100], [bnd, 50], [cashx, 10000]]);

    // Target: 60/40
    const target = new AllocationHandle(sb, [[spy, 0.6], [bnd, 0.4]]);

    const prices: [TickerHandle, number][] = [[spy, 500], [bnd, 100]];
    // Total value: 100*500 + 50*100 + 10000 = 65000
    // Target SPY: 65000 * 0.6 = 39000, current: 50000, delta: -11000, sell 22 shares
    // Target BND: 65000 * 0.4 = 26000, current: 5000, delta: +21000, buy 210 shares
    const trades = portfolio.trades(target, prices, '2026-03-31');

    const sellTrades = trades.filter(t => t.action === 'sell');
    const buyTrades = trades.filter(t => t.action === 'buy');

    expect(sellTrades).toHaveLength(1);
    expect(sellTrades[0].symbol).toBe('SPY');
    expect(sellTrades[0].quantity).toBeCloseTo(22, 4);
    expect(sellTrades[0].price).toBe(500);
    expect(sellTrades[0].date).toBe('2026-03-31');

    expect(buyTrades).toHaveLength(1);
    expect(buyTrades[0].symbol).toBe('BND');
    expect(buyTrades[0].quantity).toBeCloseTo(210, 4);
    expect(buyTrades[0].price).toBe(100);
    expect(buyTrades[0].date).toBe('2026-03-31');
  });

  it('orders sells before buys', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([[spy, 100], [bnd, 50], [cashx, 10000]]);
    const target = new AllocationHandle(sb, [[spy, 0.6], [bnd, 0.4]]);
    const prices: [TickerHandle, number][] = [[spy, 500], [bnd, 100]];

    const trades = portfolio.trades(target, prices, '2026-03-31');

    // Find the index where buys start
    const firstBuyIndex = trades.findIndex(t => t.action === 'buy');
    const lastSellIndex = trades.map((t, i) => t.action === 'sell' ? i : -1).filter(i => i >= 0).pop() ?? -1;

    if (firstBuyIndex >= 0 && lastSellIndex >= 0) {
      expect(lastSellIndex).toBeLessThan(firstBuyIndex);
    }
  });

  it('sells entire position for tickers not in target', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const gld = new TickerHandle(sb, 'GLD');
    // Hold SPY and GLD, target only has BND
    const portfolio = new PortfolioHandle([[spy, 100], [gld, 50]]);
    const target = new AllocationHandle(sb, [[bnd, 1.0]]);
    const prices: [TickerHandle, number][] = [[spy, 500], [gld, 200], [bnd, 100]];

    const trades = portfolio.trades(target, prices, '2026-03-31');

    const spySell = trades.find(t => t.symbol === 'SPY' && t.action === 'sell');
    const gldSell = trades.find(t => t.symbol === 'GLD' && t.action === 'sell');
    const bndBuy = trades.find(t => t.symbol === 'BND' && t.action === 'buy');

    expect(spySell).toBeDefined();
    expect(spySell!.quantity).toBe(100);
    expect(gldSell).toBeDefined();
    expect(gldSell!.quantity).toBe(50);
    expect(bndBuy).toBeDefined();
    // Total: 100*500 + 50*200 = 60000, all to BND at 100 = 600 shares
    expect(bndBuy!.quantity).toBeCloseTo(600, 4);
  });

  it('returns empty array when portfolio is already at target', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    // 60/40 allocation: SPY 600 shares at $100 = $60000, BND 400 shares at $100 = $40000
    const portfolio = new PortfolioHandle([[spy, 600], [bnd, 400]]);
    const target = new AllocationHandle(sb, [[spy, 0.6], [bnd, 0.4]]);
    const prices: [TickerHandle, number][] = [[spy, 100], [bnd, 100]];

    const trades = portfolio.trades(target, prices, '2026-03-31');
    expect(trades).toEqual([]);
  });

  it('handles CASHX target weight by keeping cash portion', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const cashx = new TickerHandle(sb, 'CASHX');
    // $50000 in SPY, $50000 cash
    const portfolio = new PortfolioHandle([[spy, 100], [cashx, 50000]]);
    // Target: 60% SPY, 40% cash
    const target = new AllocationHandle(sb, [[spy, 0.6], [cashx, 0.4]]);
    const prices: [TickerHandle, number][] = [[spy, 500]];

    const trades = portfolio.trades(target, prices, '2026-03-31');
    // Total: 100*500 + 50000 = 100000
    // Target SPY: 60000, current: 50000, delta: +10000, buy 20 shares
    // CASHX is not traded
    expect(trades).toHaveLength(1);
    expect(trades[0].symbol).toBe('SPY');
    expect(trades[0].action).toBe('buy');
    expect(trades[0].quantity).toBeCloseTo(20, 4);
  });

  it('never emits a CASHX trade', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([[spy, 100], [cashx, 50000]]);
    const target = new AllocationHandle(sb, [[spy, 1.0]]);
    const prices: [TickerHandle, number][] = [[spy, 500]];

    const trades = portfolio.trades(target, prices, '2026-03-31');
    const cashTrades = trades.filter(t => t.symbol === 'CASHX');
    expect(cashTrades).toHaveLength(0);
  });

  it('throws if a non-CASHX ticker is missing from prices', () => {
    const sb = mockSupabase();
    const spy = new TickerHandle(sb, 'SPY');
    const bnd = new TickerHandle(sb, 'BND');
    const portfolio = new PortfolioHandle([[spy, 100]]);
    const target = new AllocationHandle(sb, [[bnd, 1.0]]);

    // Missing both SPY and BND prices
    expect(() => portfolio.trades(target, [], '2026-03-31')).toThrow('Missing price');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts`
Expected: FAIL — `portfolio.trades is not a function`

- [ ] **Step 3: Implement trades()**

Add import at the top of `sdk/src/handles/portfolio.ts`:

```ts
import type { Trade } from '../backtest/types.js';
import { AllocationHandle } from './allocation.js';
```

Add to `PortfolioHandle`:

```ts
  trades(
    target: AllocationHandle,
    prices: [TickerHandle, number][],
    date: string,
  ): Trade[] {
    const priceMap = this._priceMap(prices);
    const totalValue = this.value(prices);

    // Build current dollar amounts by symbol
    const currentDollars = new Map<string, number>();
    for (const [ticker, quantity] of this.holdings) {
      if (ticker.symbol === 'CASHX') continue;
      const price = this._priceFor(ticker, priceMap);
      currentDollars.set(ticker.symbol, quantity * price);
    }

    // Build target dollar amounts by symbol
    const targetDollars = new Map<string, number>();
    for (const [ticker, weight] of target.holdings) {
      if (ticker.symbol === 'CASHX') continue;
      targetDollars.set(ticker.symbol, totalValue * weight);
    }

    // Build a symbol → TickerHandle lookup for price resolution
    const tickerBySymbol = new Map<string, TickerHandle>();
    for (const [ticker] of this.holdings) {
      if (ticker.symbol !== 'CASHX') tickerBySymbol.set(ticker.symbol, ticker);
    }
    for (const [ticker] of target.holdings) {
      if (ticker.symbol !== 'CASHX') tickerBySymbol.set(ticker.symbol, ticker);
    }

    // Collect all non-CASHX symbols from both sides
    const allSymbols = new Set([...currentDollars.keys(), ...targetDollars.keys()]);

    const sells: Trade[] = [];
    const buys: Trade[] = [];

    for (const symbol of allSymbols) {
      const current = currentDollars.get(symbol) ?? 0;
      const target$ = targetDollars.get(symbol) ?? 0;
      const delta = target$ - current;

      const ticker = tickerBySymbol.get(symbol)!;
      const price = this._priceFor(ticker, priceMap);

      const quantity = Math.abs(delta) / price;
      if (quantity < 1e-10) continue;

      const trade: Trade = { date, symbol, quantity, price, action: delta > 0 ? 'buy' : 'sell' };

      if (trade.action === 'sell') {
        sells.push(trade);
      } else {
        buys.push(trade);
      }
    }

    return [...sells, ...buys];
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts`
Expected: All 19 tests PASS

- [ ] **Step 5: Commit**

```bash
git add sdk/src/handles/portfolio.ts sdk/src/handles/portfolio.test.ts
git commit -m "feat(sdk): add PortfolioHandle.trades() method"
```

---

### Task 5: Client integration and exports

**Files:**
- Modify: `sdk/src/handles/index.ts`
- Modify: `sdk/src/client.ts`
- Modify: `sdk/src/index.ts`
- Modify: `sdk/src/client.test.ts`

- [ ] **Step 1: Write failing test for client.portfolio()**

Read the existing `sdk/src/client.test.ts` to understand the test pattern, then append:

```ts
it('creates a PortfolioHandle via client.portfolio()', () => {
  const spy = client.ticker('SPY');
  const cashx = client.ticker('CASHX');
  const portfolio = client.portfolio([spy, 500], [cashx, 10000]);

  expect(portfolio).toBeInstanceOf(PortfolioHandle);
  expect(portfolio.holdings).toHaveLength(2);
  expect(portfolio.holdings[0][1]).toBe(500);
  expect(portfolio.holdings[1][1]).toBe(10000);
});
```

Add `PortfolioHandle` to the imports at the top of the test file:

```ts
import { PortfolioHandle } from './handles/portfolio.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sdk && npx vitest run src/client.test.ts`
Expected: FAIL — `client.portfolio is not a function`

- [ ] **Step 3: Add PortfolioHandle to handles/index.ts**

Add to `sdk/src/handles/index.ts`:

```ts
export { PortfolioHandle } from './portfolio.js';
```

- [ ] **Step 4: Add portfolio() to LivefolioClient interface and createClient()**

In `sdk/src/client.ts`, add import:

```ts
import { PortfolioHandle } from './handles/portfolio.js';
```

Add to the `LivefolioClient` interface:

```ts
  // Portfolios
  portfolio(...holdings: [TickerHandle, number][]): PortfolioHandle;
```

Add to the `createClient()` return object:

```ts
    portfolio: (...holdings) => new PortfolioHandle(holdings),
```

- [ ] **Step 5: Add PortfolioHandle to sdk/src/index.ts**

Add to `sdk/src/index.ts`:

```ts
export { PortfolioHandle } from './handles/portfolio.js';
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/client.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full SDK test suite**

Run: `cd sdk && npx vitest run`
Expected: All tests PASS — no regressions

- [ ] **Step 8: Commit**

```bash
git add sdk/src/handles/portfolio.ts sdk/src/handles/index.ts sdk/src/client.ts sdk/src/index.ts sdk/src/client.test.ts
git commit -m "feat(sdk): integrate PortfolioHandle into client and exports"
```

---

### Task 6: Build verification

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript compiler**

Run: `cd sdk && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run full test suite one more time**

Run: `cd sdk && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Commit build artifacts if needed**

If `tsc` revealed any type issues that required fixes, commit them:

```bash
git add -u sdk/src/
git commit -m "fix(sdk): resolve type issues from PortfolioHandle integration"
```

Skip this step if no fixes were needed.
