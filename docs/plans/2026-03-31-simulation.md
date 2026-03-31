# Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `strategy.simulate()` method that runs a portfolio simulation and returns a `SimulationHandle` with equity curve (`DailyBar[]`) and trade history.

**Architecture:** Pure `runSimulation()` function in `backtest/simulate.ts` handles all portfolio math (position tracking, rebalancing, trade generation). `StrategyHandle.simulate()` is an async wrapper that fetches strategy series + price data and delegates to the pure function. `SimulationHandle` is a lightweight result class in `backtest/types.ts`.

**Tech Stack:** TypeScript, vitest for tests, existing SDK handles and types.

---

### Task 1: Types and Barrel Export

**Files:**
- Create: `sdk/src/backtest/types.ts`
- Create: `sdk/src/backtest/index.ts`

- [ ] **Step 1: Create `backtest/types.ts`**

```typescript
import type { DailyBar } from '../handles/indicator.js';

export interface SimulateOptions {
  from: string;
  to: string;
  initialCapital?: number;
}

export interface Trade {
  date: string;
  symbol: string;
  quantity: number;
  price: number;
  action: 'buy' | 'sell';
}

export class SimulationHandle {
  readonly series: DailyBar[];
  readonly trades: Trade[];
  readonly initialCapital: number;

  constructor(series: DailyBar[], trades: Trade[], initialCapital: number) {
    this.series = series;
    this.trades = trades;
    this.initialCapital = initialCapital;
  }
}
```

- [ ] **Step 2: Create `backtest/index.ts`**

```typescript
export { SimulationHandle } from './types.js';
export type { SimulateOptions, Trade } from './types.js';
export { runSimulation } from './simulate.js';
```

Note: `simulate.js` doesn't exist yet — this will cause a build error until Task 2. That's fine; we don't build between tasks.

- [ ] **Step 3: Commit**

```bash
git add sdk/src/backtest/types.ts sdk/src/backtest/index.ts
git commit -m "feat(sdk): add backtest types — SimulationHandle, Trade, SimulateOptions"
```

---

### Task 2: Pure Simulation — Single Ticker Hold

**Files:**
- Create: `sdk/src/backtest/simulate.ts`
- Create: `sdk/src/backtest/simulate.test.ts`

- [ ] **Step 1: Write failing test — initial investment and equity tracking**

```typescript
// sdk/src/backtest/simulate.test.ts
import { describe, it, expect } from 'vitest';
import { runSimulation } from './simulate.js';
import type { StrategyBar } from '../handles/strategy.js';
import { AllocationHandle } from '../handles/allocation.js';
import { TickerHandle } from '../handles/ticker.js';

// Minimal stubs — we only read .holdings, .symbol, .leverage (synchronous properties)
function stubAllocation(holdings: [{ symbol: string; leverage: number }, number][]): AllocationHandle {
  const tickerHoldings = holdings.map(
    ([t, w]) => [{ symbol: t.symbol, leverage: t.leverage } as TickerHandle, w] as [TickerHandle, number],
  );
  // Use Object.create to avoid constructor validation needing supabase
  const handle = Object.create(AllocationHandle.prototype) as AllocationHandle;
  Object.defineProperty(handle, 'holdings', { value: tickerHoldings, writable: false });
  return handle;
}

function makeBars(dates: string[], allocation: AllocationHandle): StrategyBar[] {
  return dates.map((date) => ({ date, allocation }));
}

describe('runSimulation', () => {
  it('invests on first rebalance day and tracks equity', () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06', '2025-01-07', '2025-01-08'], alloc);

    const prices = {
      SPY: {
        '2025-01-06': 500,
        '2025-01-07': 510,
        '2025-01-08': 505,
      },
    };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, 100_000);

    // Day 1: buy 200 shares @ 500 = $100,000
    expect(result.series).toHaveLength(3);
    expect(result.series[0]).toEqual({ date: '2025-01-06', value: 100_000 });
    // Day 2: 200 shares @ 510 = $102,000
    expect(result.series[1]).toEqual({ date: '2025-01-07', value: 102_000 });
    // Day 3: 200 shares @ 505 = $101,000
    expect(result.series[2]).toEqual({ date: '2025-01-08', value: 101_000 });
  });

  it('generates buy trade on initial investment', () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06'], alloc);
    const prices = { SPY: { '2025-01-06': 500 } };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, 100_000);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toEqual({
      date: '2025-01-06',
      symbol: 'SPY',
      quantity: 200,
      price: 500,
      action: 'buy',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sdk && npx vitest run src/backtest/simulate.test.ts`
Expected: FAIL — `runSimulation` not found

- [ ] **Step 3: Implement `runSimulation`**

```typescript
// sdk/src/backtest/simulate.ts
import type { DailyBar } from '../handles/indicator.js';
import type { StrategyBar } from '../handles/strategy.js';
import type { Trade } from './types.js';

const EPSILON = 1e-8;

export function runSimulation(
  bars: StrategyBar[],
  prices: Record<string, Record<string, number>>,
  rebalanceDates: Set<string>,
  initialCapital: number,
): { series: DailyBar[]; trades: Trade[] } {
  const positions: Record<string, number> = {};
  let cash = initialCapital;
  const series: DailyBar[] = [];
  const trades: Trade[] = [];

  for (const bar of bars) {
    const date = bar.date;

    if (rebalanceDates.has(date)) {
      // Compute current portfolio value before rebalancing
      let portfolioValue = cash;
      for (const [symbol, shares] of Object.entries(positions)) {
        const price = prices[symbol]?.[date];
        if (price != null) portfolioValue += shares * price;
      }

      // Determine target holdings
      const targetWeights: Record<string, number> = {};
      for (const [ticker, weight] of bar.allocation.holdings) {
        targetWeights[ticker.symbol] = weight;
      }

      // Compute target shares and execute trades
      const allSymbols = new Set([...Object.keys(positions), ...Object.keys(targetWeights)]);
      for (const symbol of allSymbols) {
        const price = prices[symbol]?.[date];
        if (price == null || price <= 0) continue;

        const currentShares = positions[symbol] ?? 0;
        const targetValue = portfolioValue * (targetWeights[symbol] ?? 0);
        const targetShares = targetValue / price;
        const delta = targetShares - currentShares;

        if (Math.abs(delta) <= EPSILON) continue;

        if (Math.abs(targetShares) <= EPSILON) {
          delete positions[symbol];
        } else {
          positions[symbol] = targetShares;
        }
        cash -= delta * price;

        trades.push({
          date,
          symbol,
          quantity: Math.abs(delta),
          price,
          action: delta > 0 ? 'buy' : 'sell',
        });
      }

      if (Math.abs(cash) <= EPSILON) cash = 0;
    }

    // Compute end-of-day portfolio value
    let value = cash;
    for (const [symbol, shares] of Object.entries(positions)) {
      const price = prices[symbol]?.[date];
      if (price != null) value += shares * price;
    }
    series.push({ date, value });
  }

  return { series, trades };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sdk && npx vitest run src/backtest/simulate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add sdk/src/backtest/simulate.ts sdk/src/backtest/simulate.test.ts
git commit -m "feat(sdk): implement runSimulation — single ticker investment and equity tracking"
```

---

### Task 3: Pure Simulation — Multi-Ticker Rebalancing

**Files:**
- Modify: `sdk/src/backtest/simulate.test.ts`

- [ ] **Step 1: Write failing test — 60/40 allocation rebalances**

Add to the existing `describe('runSimulation')` block:

```typescript
  it('rebalances multi-ticker allocation on rebalance dates', () => {
    const alloc = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 0.6],
      [{ symbol: 'TLT', leverage: 1 }, 0.4],
    ]);
    const dates = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10'];
    const bars = makeBars(dates, alloc);

    const prices = {
      SPY: {
        '2025-01-06': 500,
        '2025-01-07': 520,   // SPY up 4%
        '2025-01-08': 520,
        '2025-01-09': 520,
        '2025-01-10': 520,
      },
      TLT: {
        '2025-01-06': 100,
        '2025-01-07': 100,   // TLT flat
        '2025-01-08': 100,
        '2025-01-09': 100,
        '2025-01-10': 100,
      },
    };
    // Rebalance on day 1 and day 3
    const rebalanceDates = new Set(['2025-01-06', '2025-01-08']);

    const result = runSimulation(bars, prices, rebalanceDates, 100_000);

    // Day 1: invest 60k in SPY (120 shares @ 500), 40k in TLT (400 shares @ 100)
    expect(result.series[0].value).toBeCloseTo(100_000, 2);

    // Day 2: SPY up to 520 → 120*520=62400, TLT 400*100=40000, total=102400
    expect(result.series[1].value).toBeCloseTo(102_400, 2);

    // Day 3: rebalance to 60/40 of 102400 → SPY=61440, TLT=40960
    // SPY: 61440/520=118.15... shares, TLT: 40960/100=409.6 shares
    expect(result.series[2].value).toBeCloseTo(102_400, 2);

    // Trades: 2 buys on day 1, then sells/buys on day 3 to rebalance
    const day1Trades = result.trades.filter((t) => t.date === '2025-01-06');
    expect(day1Trades).toHaveLength(2);

    const day3Trades = result.trades.filter((t) => t.date === '2025-01-08');
    expect(day3Trades.length).toBeGreaterThan(0);
    // SPY was overweight (62400/102400=60.9%), sells some
    const spySell = day3Trades.find((t) => t.symbol === 'SPY');
    expect(spySell?.action).toBe('sell');
    // TLT was underweight, buys more
    const tltBuy = day3Trades.find((t) => t.symbol === 'TLT');
    expect(tltBuy?.action).toBe('buy');
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd sdk && npx vitest run src/backtest/simulate.test.ts`
Expected: PASS (3 tests) — the existing implementation already handles this case.

- [ ] **Step 3: Commit**

```bash
git add sdk/src/backtest/simulate.test.ts
git commit -m "test(sdk): add multi-ticker rebalancing test for runSimulation"
```

---

### Task 4: Pure Simulation — Allocation Switching

**Files:**
- Modify: `sdk/src/backtest/simulate.test.ts`

- [ ] **Step 1: Write failing test — strategy switches allocations**

Add to the existing `describe('runSimulation')` block:

```typescript
  it('switches allocations on rebalance dates', () => {
    const aggressive = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const defensive = stubAllocation([[{ symbol: 'SHY', leverage: 1 }, 1.0]]);

    // Days 1-2: aggressive, Day 3: switch to defensive
    const bars: StrategyBar[] = [
      { date: '2025-01-06', allocation: aggressive },
      { date: '2025-01-07', allocation: aggressive },
      { date: '2025-01-08', allocation: defensive },
    ];

    const prices = {
      SPY: {
        '2025-01-06': 500,
        '2025-01-07': 510,
        '2025-01-08': 505,
      },
      SHY: {
        '2025-01-06': 80,
        '2025-01-07': 80,
        '2025-01-08': 80,
      },
    };
    const rebalanceDates = new Set(['2025-01-06', '2025-01-08']);

    const result = runSimulation(bars, prices, rebalanceDates, 100_000);

    // Day 1: buy 200 SPY @ 500
    expect(result.series[0].value).toBeCloseTo(100_000, 2);
    // Day 2: 200 SPY @ 510 = 102_000
    expect(result.series[1].value).toBeCloseTo(102_000, 2);
    // Day 3: sell SPY @ 505, portfolio = 200*505 = 101_000, buy SHY @ 80 → 1262.5 shares
    expect(result.series[2].value).toBeCloseTo(101_000, 2);

    // Should have: buy SPY, sell SPY, buy SHY
    const day3Trades = result.trades.filter((t) => t.date === '2025-01-08');
    expect(day3Trades).toHaveLength(2);
    expect(day3Trades.find((t) => t.symbol === 'SPY')?.action).toBe('sell');
    expect(day3Trades.find((t) => t.symbol === 'SHY')?.action).toBe('buy');
  });

  it('holds cash before first rebalance date', () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06', '2025-01-07', '2025-01-08'], alloc);
    const prices = {
      SPY: { '2025-01-06': 500, '2025-01-07': 510, '2025-01-08': 505 },
    };
    // First rebalance not until day 2
    const rebalanceDates = new Set(['2025-01-07']);

    const result = runSimulation(bars, prices, rebalanceDates, 100_000);

    // Day 1: all cash, no investment yet
    expect(result.series[0].value).toBeCloseTo(100_000, 2);
    expect(result.trades.filter((t) => t.date === '2025-01-06')).toHaveLength(0);
    // Day 2: invest
    expect(result.series[1].value).toBeCloseTo(100_000, 2);
    expect(result.trades.filter((t) => t.date === '2025-01-07')).toHaveLength(1);
  });

  it('skips symbol with missing price data', () => {
    const alloc = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 0.6],
      [{ symbol: 'MISSING', leverage: 1 }, 0.4],
    ]);
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);
    const prices = {
      SPY: { '2025-01-06': 500, '2025-01-07': 510 },
      // MISSING has no price data at all
    };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, 100_000);

    // Only SPY is bought; MISSING is skipped. Cash retains the 40% for MISSING.
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].symbol).toBe('SPY');
    // Portfolio = 60k in SPY (120 shares) + 40k cash = 100k
    expect(result.series[0].value).toBeCloseTo(100_000, 2);
    // Day 2: SPY up to 510 → 120*510=61200 + 40k cash = 101200
    expect(result.series[1].value).toBeCloseTo(101_200, 2);
  });

  it('defaults initialCapital to 100_000', () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06'], alloc);
    const prices = { SPY: { '2025-01-06': 500 } };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, 100_000);

    expect(result.series[0].value).toBeCloseTo(100_000, 2);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/backtest/simulate.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 3: Commit**

```bash
git add sdk/src/backtest/simulate.test.ts
git commit -m "test(sdk): add allocation switching and edge case tests for runSimulation"
```

---

### Task 5: StrategyHandle.simulate() Method

**Files:**
- Modify: `sdk/src/handles/strategy.ts`
- Create: `sdk/src/handles/strategy-simulate.test.ts`

- [ ] **Step 1: Write failing test for `strategy.simulate()`**

This test mocks the strategy's internal methods to avoid DB calls:

```typescript
// sdk/src/handles/strategy-simulate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { StrategyHandle } from './strategy.js';
import { AllocationHandle } from './allocation.js';
import { TickerHandle } from './ticker.js';
import type { StrategyBar } from './strategy.js';
import type { DailyBar } from './indicator.js';

function stubAllocation(holdings: [{ symbol: string; leverage: number }, number][]): AllocationHandle {
  const tickerHoldings = holdings.map(
    ([t, w]) => [{ symbol: t.symbol, leverage: t.leverage } as TickerHandle, w] as [TickerHandle, number],
  );
  const handle = Object.create(AllocationHandle.prototype) as AllocationHandle;
  Object.defineProperty(handle, 'holdings', { value: tickerHoldings, writable: false });
  return handle;
}

describe('StrategyHandle.simulate', () => {
  it('returns SimulationHandle with series and trades', async () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);

    const bars: StrategyBar[] = [
      { date: '2025-01-06', allocation: alloc },
      { date: '2025-01-07', allocation: alloc },
      { date: '2025-01-08', allocation: alloc },
    ];

    const priceBars: DailyBar[] = [
      { date: '2025-01-06', value: 500 },
      { date: '2025-01-07', value: 510 },
      { date: '2025-01-08', value: 505 },
    ];

    // Create a StrategyHandle and mock its internals
    const supabase = {} as any;
    const strategy = new StrategyHandle(supabase, {
      name: 'Test',
      freq: 'Daily',
      rules: [{ hold: alloc }],
    });

    // Mock series() to return our bars
    vi.spyOn(strategy, 'series').mockResolvedValue(bars);

    // Mock _fetchPricesForTickers (private, accessed via prototype)
    vi.spyOn(strategy as any, '_fetchPricesForTickers').mockResolvedValue({
      SPY: Object.fromEntries(priceBars.map((b) => [b.date, b.value])),
    });

    const sim = await strategy.simulate({ from: '2025-01-06', to: '2025-01-08' });

    expect(sim.series).toHaveLength(3);
    expect(sim.series[0]).toEqual({ date: '2025-01-06', value: 100_000 });
    expect(sim.series[1]).toEqual({ date: '2025-01-07', value: 102_000 });
    expect(sim.trades.length).toBeGreaterThan(0);
    expect(sim.initialCapital).toBe(100_000);
  });

  it('respects custom initialCapital', async () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const bars: StrategyBar[] = [{ date: '2025-01-06', allocation: alloc }];
    const supabase = {} as any;
    const strategy = new StrategyHandle(supabase, {
      name: 'Test',
      freq: 'Daily',
      rules: [{ hold: alloc }],
    });

    vi.spyOn(strategy, 'series').mockResolvedValue(bars);
    vi.spyOn(strategy as any, '_fetchPricesForTickers').mockResolvedValue({
      SPY: { '2025-01-06': 500 },
    });

    const sim = await strategy.simulate({ from: '2025-01-06', to: '2025-01-06', initialCapital: 50_000 });

    expect(sim.initialCapital).toBe(50_000);
    expect(sim.series[0].value).toBeCloseTo(50_000, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sdk && npx vitest run src/handles/strategy-simulate.test.ts`
Expected: FAIL — `strategy.simulate is not a function`

- [ ] **Step 3: Add `simulate()` method and `_fetchPricesForTickers` to StrategyHandle**

Add these imports at the top of `sdk/src/handles/strategy.ts`:

```typescript
import { IndicatorHandle } from './indicator.js';
import type { DailyBar } from './indicator.js';
import { runSimulation } from '../backtest/simulate.js';
import { SimulationHandle } from '../backtest/types.js';
import type { SimulateOptions } from '../backtest/types.js';
```

Add these methods to the `StrategyHandle` class body (after the `value()` method):

```typescript
  async simulate(options: SimulateOptions): Promise<SimulationHandle> {
    const bars = await this.series({ from: options.from, to: options.to });
    if (bars.length === 0) {
      const capital = options.initialCapital ?? 100_000;
      return new SimulationHandle([], [], capital);
    }

    const prices = await this._fetchPricesForTickers(bars, options.from, options.to);
    const tradingDays = bars.map((b) => b.date);
    const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);
    const initialCapital = options.initialCapital ?? 100_000;

    const result = runSimulation(bars, prices, rebalanceDates, initialCapital);
    return new SimulationHandle(result.series, result.trades, initialCapital);
  }

  private async _fetchPricesForTickers(
    bars: StrategyBar[],
    from: string,
    to: string,
  ): Promise<Record<string, Record<string, number>>> {
    // Collect unique ticker symbols from all allocations
    const tickerMap = new Map<string, TickerHandle>();
    for (const bar of bars) {
      for (const [ticker] of bar.allocation.holdings) {
        if (!tickerMap.has(ticker.symbol)) {
          tickerMap.set(ticker.symbol, ticker);
        }
      }
    }

    // Fetch price series for each ticker in parallel
    const entries = await Promise.all(
      Array.from(tickerMap.entries()).map(async ([symbol, ticker]) => {
        const priceIndicator = new IndicatorHandle(
          this._supabase,
          { type: 'Price', ticker, lookback: 0, delay: 0, unit: null, threshold: null },
          this._config,
        );
        const priceBars = await priceIndicator.series({ from, to });
        const dateMap: Record<string, number> = {};
        for (const bar of priceBars) {
          dateMap[bar.date] = bar.value;
        }
        return [symbol, dateMap] as const;
      }),
    );

    return Object.fromEntries(entries);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/handles/strategy-simulate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run all backtest tests together**

Run: `cd sdk && npx vitest run src/backtest/ src/handles/strategy-simulate.test.ts`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add sdk/src/handles/strategy.ts sdk/src/handles/strategy-simulate.test.ts
git commit -m "feat(sdk): add StrategyHandle.simulate() method"
```

---

### Task 6: Public Exports

**Files:**
- Modify: `sdk/src/index.ts`

- [ ] **Step 1: Add backtest exports to `sdk/src/index.ts`**

Add after the existing exports:

```typescript
export { SimulationHandle } from './backtest/types.js';
export type { SimulateOptions, Trade } from './backtest/types.js';
```

- [ ] **Step 2: Verify build compiles**

Run: `cd sdk && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `cd sdk && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add sdk/src/index.ts sdk/src/backtest/index.ts
git commit -m "feat(sdk): export SimulationHandle, SimulateOptions, Trade from public API"
```
