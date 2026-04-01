# Simulate with PortfolioHandle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `initialCapital: number` with `portfolio: PortfolioHandle` across the simulation API so backtests can start from existing positions.

**Architecture:** Update `SimulateOptions` and `SimulationHandle` types, change `runSimulation` to extract positions/cash from a `PortfolioHandle`, and update `StrategyHandle.simulate` to pass portfolio through and force day 1 as a rebalance date. All existing tests updated to use cash-only portfolios.

**Tech Stack:** TypeScript, Vitest, existing SDK handle pattern

**Spec:** `sdk/docs/specs/2026-04-01-simulate-portfolio-design.md`

---

### Task 1: Update SimulateOptions and SimulationHandle types

**Files:**
- Modify: `sdk/src/backtest/types.ts`

- [ ] **Step 1: Update SimulateOptions to use portfolio**

Replace the `SimulateOptions` interface and `SimulationHandle` class in `sdk/src/backtest/types.ts`:

```ts
import type { DailyBar } from '../handles/indicator.js';
import { PortfolioHandle } from '../handles/portfolio.js';

export interface SimulateOptions {
  from: string;
  to: string;
  portfolio: PortfolioHandle;
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
  readonly startingPortfolio: PortfolioHandle;

  constructor(series: DailyBar[], trades: Trade[], startingPortfolio: PortfolioHandle) {
    this.series = series;
    this.trades = trades;
    this.startingPortfolio = startingPortfolio;
  }
}
```

- [ ] **Step 2: Verify the file compiles in isolation**

Run: `cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx tsc --noEmit src/backtest/types.ts 2>&1 | head -5`
Expected: May show downstream errors (callers still use old API) — that's OK. The types file itself should have no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && git add src/backtest/types.ts && git commit -m "refactor(sdk): update SimulateOptions and SimulationHandle to use PortfolioHandle"
```

---

### Task 2: Update runSimulation and simulate.test.ts

**Files:**
- Modify: `sdk/src/backtest/simulate.ts`
- Modify: `sdk/src/backtest/simulate.test.ts`

- [ ] **Step 1: Update simulate.test.ts to use PortfolioHandle**

Add imports at the top of `sdk/src/backtest/simulate.test.ts`:

```ts
import { PortfolioHandle } from '../handles/portfolio.js';
```

Add a helper after the existing `makeBars` function:

```ts
function stubPortfolio(holdings: [{ symbol: string; leverage: number }, number][]): PortfolioHandle {
  const tickerHoldings = holdings.map(
    ([t, qty]) => [{ symbol: t.symbol, leverage: t.leverage } as TickerHandle, qty] as [TickerHandle, number],
  );
  return new PortfolioHandle(tickerHoldings);
}

function cashPortfolio(amount: number): PortfolioHandle {
  return stubPortfolio([[{ symbol: 'CASHX', leverage: 1 }, amount]]);
}
```

Then replace every `runSimulation(bars, prices, rebalanceDates, 100_000)` call with `runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000))`. There are 7 tests to update:

Test 1 "invests on first rebalance day" (line 36):
```ts
const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));
```

Test 2 "generates buy trade on initial investment" (line 53):
```ts
const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));
```

Test 3 "rebalances multi-ticker allocation on rebalance dates" (line 91):
```ts
const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));
```

Test 4 "switches allocations on rebalance dates" (line 132):
```ts
const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));
```

Test 5 "holds cash before first rebalance date" (line 152):
```ts
const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));
```

Test 6 "skips symbol with missing price data" (line 171):
```ts
const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));
```

Test 7 "returns empty results for empty bars" (line 180):
```ts
const result = runSimulation([], {}, new Set(), cashPortfolio(100_000));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/backtest/simulate.test.ts`
Expected: FAIL — type errors because `runSimulation` still accepts `number`

- [ ] **Step 3: Update runSimulation to accept PortfolioHandle**

Replace the function signature and seeding logic in `sdk/src/backtest/simulate.ts`:

```ts
import type { DailyBar } from '../handles/indicator.js';
import type { StrategyBar } from '../handles/strategy.js';
import type { Trade } from './types.js';
import { PortfolioHandle } from '../handles/portfolio.js';

const EPSILON = 1e-8;

export function runSimulation(
  bars: StrategyBar[],
  prices: Record<string, Record<string, number>>,
  rebalanceDates: Set<string>,
  portfolio: PortfolioHandle,
): { series: DailyBar[]; trades: Trade[] } {
  const positions: Record<string, number> = {};
  let cash = 0;
  for (const [ticker, quantity] of portfolio.holdings) {
    if (ticker.symbol === 'CASHX') {
      cash = quantity;
    } else {
      positions[ticker.symbol] = quantity;
    }
  }
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/backtest/simulate.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && git add src/backtest/simulate.ts src/backtest/simulate.test.ts && git commit -m "refactor(sdk): update runSimulation to accept PortfolioHandle"
```

---

### Task 3: New test for starting from existing positions

**Files:**
- Modify: `sdk/src/backtest/simulate.test.ts`

- [ ] **Step 1: Write test for non-cash starting portfolio**

Append to the `describe('runSimulation')` block in `sdk/src/backtest/simulate.test.ts`:

```ts
  it('starts simulation from existing positions', () => {
    const alloc = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 0.6],
      [{ symbol: 'TLT', leverage: 1 }, 0.4],
    ]);
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);

    const prices = {
      SPY: { '2025-01-06': 500, '2025-01-07': 510 },
      TLT: { '2025-01-06': 100, '2025-01-07': 102 },
    };
    const rebalanceDates = new Set(['2025-01-06']);

    // Start with 100 shares SPY + $20,000 cash (no TLT)
    // Total value: 100*500 + 20000 = 70000
    const portfolio = stubPortfolio([
      [{ symbol: 'SPY', leverage: 1 }, 100],
      [{ symbol: 'CASHX', leverage: 1 }, 20_000],
    ]);

    const result = runSimulation(bars, prices, rebalanceDates, portfolio);

    // Day 1 rebalance: target SPY = 42000 (84 shares), target TLT = 28000 (280 shares)
    // Sell 16 SPY, buy 280 TLT
    const spyTrade = result.trades.find((t) => t.symbol === 'SPY');
    const tltTrade = result.trades.find((t) => t.symbol === 'TLT');

    expect(spyTrade).toBeDefined();
    expect(spyTrade!.action).toBe('sell');
    expect(spyTrade!.quantity).toBeCloseTo(16, 4);

    expect(tltTrade).toBeDefined();
    expect(tltTrade!.action).toBe('buy');
    expect(tltTrade!.quantity).toBeCloseTo(280, 4);

    // Portfolio value stays at 70000 on day 1
    expect(result.series[0].value).toBeCloseTo(70_000, 0);
    // Day 2: 84 * 510 + 280 * 102 = 42840 + 28560 = 71400
    expect(result.series[1].value).toBeCloseTo(71_400, 0);
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/backtest/simulate.test.ts`
Expected: All 8 tests PASS (the implementation already handles non-empty positions)

- [ ] **Step 3: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && git add src/backtest/simulate.test.ts && git commit -m "test(sdk): add test for simulation starting from existing positions"
```

---

### Task 4: Update StrategyHandle.simulate and strategy-simulate.test.ts

**Files:**
- Modify: `sdk/src/handles/strategy.ts:507-521`
- Modify: `sdk/src/handles/strategy-simulate.test.ts`
- Modify: `sdk/src/index.ts` (export update if needed)

- [ ] **Step 1: Update strategy-simulate.test.ts**

Add import at top of `sdk/src/handles/strategy-simulate.test.ts`:

```ts
import { PortfolioHandle } from './portfolio.js';
```

Update test 1 "returns SimulationHandle with series and trades" (line 46-52):

Replace:
```ts
    const sim = await strategy.simulate({ from: '2025-01-06', to: '2025-01-08' });

    expect(sim.series).toHaveLength(3);
    expect(sim.series[0]).toEqual({ date: '2025-01-06', value: 100_000 });
    expect(sim.series[1]).toEqual({ date: '2025-01-07', value: 102_000 });
    expect(sim.trades.length).toBeGreaterThan(0);
    expect(sim.initialCapital).toBe(100_000);
```

With:
```ts
    const cashx = { symbol: 'CASHX', leverage: 1 } as TickerHandle;
    const portfolio = new PortfolioHandle([[cashx, 100_000]]);
    const sim = await strategy.simulate({ from: '2025-01-06', to: '2025-01-08', portfolio });

    expect(sim.series).toHaveLength(3);
    expect(sim.series[0]).toEqual({ date: '2025-01-06', value: 100_000 });
    expect(sim.series[1]).toEqual({ date: '2025-01-07', value: 102_000 });
    expect(sim.trades.length).toBeGreaterThan(0);
    expect(sim.startingPortfolio).toBe(portfolio);
```

Update test 2 "respects custom initialCapital" — rename to "respects custom portfolio" and replace (lines 55-75):

```ts
  it('respects custom portfolio', async () => {
    const alloc = stubAllocation([[{ symbol: 'SPY', leverage: 1 }, 1.0]]);
    const bars: StrategyBar[] = [{ date: '2025-01-06', allocation: alloc }];
    const supabase = {} as ConstructorParameters<typeof StrategyHandle>[0];
    const strategy = new StrategyHandle(supabase, {
      name: 'Test',
      freq: 'Daily',
      rules: [{ hold: alloc }],
    });

    vi.spyOn(strategy, 'series').mockResolvedValue(bars);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(strategy as any, '_fetchPricesForTickers').mockResolvedValue({
      SPY: { '2025-01-06': 500 },
    });

    const cashx = { symbol: 'CASHX', leverage: 1 } as TickerHandle;
    const portfolio = new PortfolioHandle([[cashx, 50_000]]);
    const sim = await strategy.simulate({ from: '2025-01-06', to: '2025-01-06', portfolio });

    expect(sim.startingPortfolio).toBe(portfolio);
    expect(sim.series[0].value).toBeCloseTo(50_000, 2);
  });
```

Update test 3 "returns empty SimulationHandle when no bars" (lines 77-93):

Replace:
```ts
    const sim = await strategy.simulate({ from: '2025-01-06', to: '2025-01-08' });

    expect(sim.series).toHaveLength(0);
    expect(sim.trades).toHaveLength(0);
    expect(sim.initialCapital).toBe(100_000);
```

With:
```ts
    const cashx = { symbol: 'CASHX', leverage: 1 } as TickerHandle;
    const portfolio = new PortfolioHandle([[cashx, 100_000]]);
    const sim = await strategy.simulate({ from: '2025-01-06', to: '2025-01-08', portfolio });

    expect(sim.series).toHaveLength(0);
    expect(sim.trades).toHaveLength(0);
    expect(sim.startingPortfolio).toBe(portfolio);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/strategy-simulate.test.ts`
Expected: FAIL — `strategy.simulate` still expects old options shape

- [ ] **Step 3: Update StrategyHandle.simulate**

Replace the `simulate` method in `sdk/src/handles/strategy.ts` (line 507-521):

```ts
  async simulate(options: SimulateOptions): Promise<SimulationHandle> {
    const bars = await this.series({ from: options.from, to: options.to });
    if (bars.length === 0) {
      return new SimulationHandle([], [], options.portfolio);
    }

    const prices = await this._fetchPricesForTickers(bars, options.from, options.to);
    const tradingDays = bars.map((b) => b.date);
    const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);

    // Force day 1 rebalance so existing positions align to strategy
    rebalanceDates.add(bars[0].date);

    const result = runSimulation(bars, prices, rebalanceDates, options.portfolio);
    return new SimulationHandle(result.series, result.trades, options.portfolio);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/strategy-simulate.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && git add src/handles/strategy.ts src/handles/strategy-simulate.test.ts && git commit -m "refactor(sdk): update StrategyHandle.simulate to use PortfolioHandle"
```

---

### Task 5: Update public exports and build verification

**Files:**
- Modify: `sdk/src/index.ts` (if needed)

- [ ] **Step 1: Check that index.ts exports are correct**

`SimulateOptions` is already exported as a type from `sdk/src/index.ts`. Verify the export still works — `initialCapital` is gone, `portfolio` is the new field. No changes needed to the export line itself, just verify it compiles.

- [ ] **Step 2: Run TypeScript compiler**

Run: `cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run`
Expected: All tests PASS — no regressions

- [ ] **Step 4: Commit if any fixes were needed**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && git add -u src/ && git commit -m "fix(sdk): resolve type issues from simulate portfolio integration"
```

Skip this step if no fixes were needed.
