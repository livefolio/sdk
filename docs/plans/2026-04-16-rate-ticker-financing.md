# Rate Ticker Financing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model rate tickers (DTB3, DFF) as financing legs with a unified `$1-price share` model, enabling negative quantities for borrowing and compounding daily interest at the FRED 360-day convention.

**Architecture:** Rate tickers are represented as regular entries in the simulator's `positions` map where share count equals dollar amount (implicit $1 price). Daily accrual multiplies share count by `(1 + L × rate% / 100 × days / 360)` using the previous bar's rate. `PortfolioHandle` drops its non-negative quantity invariant so that borrowed positions (and future general shorts) are representable.

**Tech Stack:** TypeScript, vitest, monorepo with `sdk/`, `market/`, `storage/`, `cli/` as separate packages. `isRateTickerSymbol()` helper already exists in `sdk/src/providers/mappings.ts`.

**Spec:** `docs/specs/2026-04-16-rate-ticker-financing-design.md`

---

## File Structure

- **Modify** `sdk/src/handles/portfolio.ts` — drop negative-quantity throw (lines 18-20); add rate-ticker case to `_priceFor` (lines 34-42).
- **Modify** `sdk/src/handles/portfolio.test.ts` — replace the "throws on negative" test with "accepts negative quantities"; add rate-ticker valuation tests.
- **Modify** `sdk/src/handles/indicator.ts` — skip leverage-compounding block (lines 194-215) when the ticker is a rate ticker.
- **Modify** `sdk/src/handles/sync.test.ts` — add test for rate-ticker leverage no-op.
- **Modify** `sdk/src/backtest/simulate.ts` — special-case rate tickers in NAV valuation (lines 50-53, 93-98) and rebalance (lines 62-88) to use implicit $1 price; add per-bar accrual step before the rebalance check.
- **Modify** `sdk/src/backtest/simulate.test.ts` — add rate-ticker scenarios.

All changes live in the `sdk/` package. Integration rerun is via `cli/scripts/backtest-all.ts`.

---

## Task 1: Drop non-negative invariant in PortfolioHandle

**Files:**
- Modify: `sdk/src/handles/portfolio.ts:18-20`
- Test: `sdk/src/handles/portfolio.test.ts:40-44`

- [ ] **Step 1: Replace the existing "throws on negative" test**

In `sdk/src/handles/portfolio.test.ts`, locate the block at lines 40-44 that reads:
```ts
it('throws on negative quantities', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    expect(() => new PortfolioHandle([[spy, -100]])).toThrow('negative');
  });
```
Replace it with:
```ts
it('accepts negative quantities (borrowed / short positions)', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const handle = new PortfolioHandle([[spy, -100]]);
    expect(handle.holdings).toHaveLength(1);
    expect(handle.holdings[0]![1]).toBe(-100);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts -t "accepts negative"`
Expected: FAIL with "Quantity for SPY is negative: -100"

- [ ] **Step 3: Remove the throw from PortfolioHandle constructor**

In `sdk/src/handles/portfolio.ts`, delete lines 18-20:
```ts
      if (quantity < 0) {
        throw new Error(`Quantity for ${ticker.symbol} is negative: ${quantity}`);
      }
```
The surrounding duplicate-ticker check stays.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts`
Expected: all PortfolioHandle tests pass.

- [ ] **Step 5: Commit**

```bash
cd sdk && git add src/handles/portfolio.ts src/handles/portfolio.test.ts && git commit -m "$(cat <<'EOF'
feat(portfolio): allow negative quantities for borrowing and shorts

Removes the non-negative invariant from PortfolioHandle's constructor.
Enables representing borrowed cash (via negative rate-ticker shares)
and lays the groundwork for general short positions.
EOF
)"
```

---

## Task 2: PortfolioHandle._priceFor returns $1 for rate tickers

**Files:**
- Modify: `sdk/src/handles/portfolio.ts:1-5` (imports) and `:34-42` (`_priceFor`)
- Test: `sdk/src/handles/portfolio.test.ts`

- [ ] **Step 1: Write failing tests for rate-ticker valuation**

Append to `sdk/src/handles/portfolio.test.ts` inside the existing `describe('PortfolioHandle.value', ...)` block (find the closing `});` of that block and insert before it):

```ts
  it('treats rate-ticker price as 1.0 regardless of provided prices', () => {
    const sb = mockStorage();
    const dtb3 = new TickerHandle(sb, 'DTB3');
    const spy = new TickerHandle(sb, 'SPY');
    const portfolio = new PortfolioHandle([[dtb3, -50_000], [spy, 100]]);
    // Price table carries the *rate* (e.g. 5.25%); must be ignored for DTB3
    const prices: [TickerHandle, number][] = [[dtb3, 5.25], [spy, 500]];
    // -50000 * 1.0 + 100 * 500 = -50000 + 50000 = 0
    expect(portfolio.value(prices)).toBeCloseTo(0, 2);
  });

  it('allows mixed long / short / rate holdings', () => {
    const sb = mockStorage();
    const spy = new TickerHandle(sb, 'SPY');
    const dtb3 = new TickerHandle(sb, 'DTB3');
    const cashx = new TickerHandle(sb, 'CASHX');
    const portfolio = new PortfolioHandle([
      [spy, 300],
      [dtb3, -50_000],
      [cashx, 0],
    ]);
    const prices: [TickerHandle, number][] = [[spy, 500], [dtb3, 5.25]];
    // 300 * 500 + -50000 * 1 + 0 * 1 = 150000 - 50000 = 100000
    expect(portfolio.value(prices)).toBeCloseTo(100_000, 2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts -t "rate-ticker price"`
Expected: FAIL — DTB3 is valued using 5.25, not 1.0.

- [ ] **Step 3: Update `_priceFor` to treat rate tickers like CASHX**

Edit `sdk/src/handles/portfolio.ts`. First, add the import at the top (line 1 area):

```ts
import { isRateTickerSymbol } from '../providers/mappings';
```

Then change the `_priceFor` method. Locate lines 34-42:
```ts
  private _priceFor(ticker: TickerHandle, priceMap: Map<string, number>): number {
    if (ticker.symbol === 'CASHX') return 1;
    const key = `${ticker.symbol}:${ticker.leverage}`;
    const price = priceMap.get(key);
    if (price == null) {
      throw new Error(`Missing price for ${ticker.symbol}`);
    }
    return price;
  }
```
Replace with:
```ts
  private _priceFor(ticker: TickerHandle, priceMap: Map<string, number>): number {
    if (ticker.symbol === 'CASHX') return 1;
    if (isRateTickerSymbol(ticker.symbol)) return 1;
    const key = `${ticker.symbol}:${ticker.leverage}`;
    const price = priceMap.get(key);
    if (price == null) {
      throw new Error(`Missing price for ${ticker.symbol}`);
    }
    return price;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/handles/portfolio.test.ts`
Expected: all PortfolioHandle tests pass.

- [ ] **Step 5: Commit**

```bash
cd sdk && git add src/handles/portfolio.ts src/handles/portfolio.test.ts && git commit -m "$(cat <<'EOF'
feat(portfolio): treat rate-ticker price as $1 in valuation

Rate tickers (DTB3, DFF, etc.) use an implicit $1 price in NAV
calculation. The 'price' in the input priceMap for these is the
annualized rate (percent), which is meaningful only for interest
accrual, not for marking the position.
EOF
)"
```

---

## Task 3: Skip leverage compounding for rate-ticker Price indicators

**Files:**
- Modify: `sdk/src/handles/indicator.ts:194-215`
- Test: `sdk/src/handles/sync.test.ts` (append to the `_sync`/leverage test group; follow the pattern at line 117)

- [ ] **Step 1: Write failing test**

Append to `sdk/src/handles/sync.test.ts` (after the existing leverage tests — find the end of the `describe` block that contains the test at line 117 and insert before its closing `});`):

```ts
  it('does not apply leverage compounding to rate-ticker Price series', async () => {
    const writtenBars: { date: string; value: number }[][] = [];
    const storage = mockStorage({
      indicators: {
        findOrCreate: vi.fn().mockResolvedValue({ id: 20 }),
        getSeries: vi.fn().mockResolvedValue([]),
        writeSeries: vi.fn().mockImplementation((_id: number, bars: { date: string; value: number }[]) => {
          writtenBars.push(bars);
          return Promise.resolve();
        }),
        getLatestSeriesDate: vi.fn().mockResolvedValue(null),
        getValue: vi.fn().mockResolvedValue(null),
      },
    });
    const market = mockMarket({
      fetchBars: vi.fn().mockResolvedValue([
        { date: '2026-03-27', value: 5.25 },
        { date: '2026-03-28', value: 5.30 },
      ]),
    });
    const ticker = new TickerHandle(storage, 'DTB3', 2);

    const handle = new IndicatorHandle(storage, market, {
      type: 'Price',
      ticker,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.series();

    expect(writtenBars).toHaveLength(1);
    const values = writtenBars[0]!.map((b) => b.value);
    // Values are preserved verbatim — no leverage compounding for rate tickers.
    expect(values[0]).toBeCloseTo(5.25, 5);
    expect(values[1]).toBeCloseTo(5.30, 5);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd sdk && npx vitest run src/handles/sync.test.ts -t "rate-ticker"`
Expected: FAIL — without the fix, `values[1]` becomes `5.25 × (1 + 2 × (5.30/5.25 − 1)) ≈ 5.35` (leverage-compounded).

- [ ] **Step 3: Add rate-ticker guard in indicator sync**

Edit `sdk/src/handles/indicator.ts`. First, ensure the import of `isRateTickerSymbol` exists. Locate line 5 (`import { getProviderInfo } from '../providers/mappings';`) and change it to:

```ts
import { getProviderInfo, isRateTickerSymbol } from '../providers/mappings';
```

Then locate the leverage-compounding block (lines 194-215) that begins with:
```ts
    // Apply leverage to daily returns only for fetched (non-computed) indicators.
    // Computed indicators (RSI, SMA, etc.) already read from the leveraged price series.
    const leverage = this.ticker?.leverage ?? 1;
    if (leverage !== 1 && info.provider !== 'computed' && bars.length > 0) {
```
Change the `if` condition to also exclude rate tickers:

```ts
    // Apply leverage to daily returns only for fetched (non-computed) indicators.
    // Computed indicators (RSI, SMA, etc.) already read from the leveraged price series.
    // Rate tickers (DTB3, DFF, etc.) skip leverage compounding: the stored series
    // stays raw; the simulator applies the leverage multiplier at accrual time.
    const leverage = this.ticker?.leverage ?? 1;
    const isRate = isRateTickerSymbol(this.ticker?.symbol ?? null);
    if (leverage !== 1 && info.provider !== 'computed' && !isRate && bars.length > 0) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/handles/sync.test.ts`
Expected: all sync tests pass.

- [ ] **Step 5: Commit**

```bash
cd sdk && git add src/handles/indicator.ts src/handles/sync.test.ts && git commit -m "$(cat <<'EOF'
feat(indicator): skip leverage compounding for rate-ticker Price series

Applying daily-return leverage compounding to a rate series (e.g.
DTB3, DFF) is meaningless. The stored Price series for DTB3?L=2 is
now identical to DTB3?L=1 — just the raw rate. The simulator
applies the leverage multiplier at interest-accrual time.
EOF
)"
```

---

## Task 4: Simulator — rate ticker is $1-priced in NAV and rebalance

**Files:**
- Modify: `sdk/src/backtest/simulate.ts` (imports, `valuationPrice` helper, rebalance loop)
- Test: `sdk/src/backtest/simulate.test.ts`

- [ ] **Step 1: Write failing tests for NAV + rebalance with rate ticker**

Append to `sdk/src/backtest/simulate.test.ts` inside the existing `describe('runSimulation', ...)` block (insert before the closing `});` of that describe):

```ts
  it('values rate-ticker positions at implicit $1 in NAV', () => {
    const alloc = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);
    // Starting portfolio includes a borrowed DTB3 position (allowed by Task 1).
    const portfolio = stubPortfolio([
      [{ symbol: 'CASHX', leverage: 1 }, 150_000],
      [{ symbol: 'DTB3', leverage: 1 }, -50_000],
    ]);
    const prices = { 'DTB3:1': { '2025-01-06': 5.25, '2025-01-07': 5.25 } };
    const rebalanceDates = new Set<string>(); // no rebalance — just value tracking

    const result = runSimulation(bars, prices, rebalanceDates, portfolio);

    // NAV = cash + DTB3 quantity × $1 = 150000 − 50000 = 100000
    expect(result.series[0]).toEqual({ date: '2025-01-06', value: 100_000 });
    // Without accrual (covered in Task 5), value stays flat here.
    expect(result.series[1]!.value).toBeCloseTo(100_000, 2);
  });

  it('rebalances into a borrowed rate-ticker leg at $1 price', () => {
    const alloc = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 1.5],
      [{ symbol: 'DTB3', leverage: 1 }, -0.5],
    ]);
    const bars = makeBars(['2025-01-06'], alloc);
    const prices = {
      'SPY:1': { '2025-01-06': 500 },
      'DTB3:1': { '2025-01-06': 5.25 },
    };
    const rebalanceDates = new Set(['2025-01-06']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    // Target: SPY = 150k ÷ 500 = 300 shares; DTB3 = −50k ÷ $1 = −50000 shares.
    // Cash: 100k − (300 × 500) − (−50000 × 1) = 100k − 150k + 50k = 0.
    // NAV = 0 + 300×500 + (−50000)×1 = 100000.
    expect(result.series[0]).toEqual({ date: '2025-01-06', value: 100_000 });

    const tradeBySymbol = Object.fromEntries(result.trades.map((t) => [t.symbol, t]));
    expect(tradeBySymbol.SPY).toMatchObject({ action: 'buy', quantity: 300, price: 500 });
    expect(tradeBySymbol.DTB3).toMatchObject({ action: 'sell', quantity: 50_000, price: 1 });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sdk && npx vitest run src/backtest/simulate.test.ts -t "rate-ticker\|borrowed rate-ticker"`
Expected: FAIL — the current code divides by `prices[DTB3:1][date]` (= 5.25), producing nonsense share counts.

- [ ] **Step 3: Add a helper and update NAV / rebalance to use $1 for rate tickers**

Edit `sdk/src/backtest/simulate.ts`. First, add the import near the top (after the existing imports at lines 1-5):

```ts
import { isRateTickerSymbol } from '../providers/mappings';
```

Add a key helper right after the existing `tkey` function (after line 11):

```ts
function symbolFromKey(key: string): string {
  const idx = key.lastIndexOf(':');
  return idx === -1 ? key : key.slice(0, idx);
}

function isRateKey(key: string): boolean {
  return isRateTickerSymbol(symbolFromKey(key));
}

function navPriceForKey(
  key: string,
  date: string,
  prices: Record<string, Record<string, number>>,
  lastPrice: Record<string, number>,
): number | undefined {
  if (isRateKey(key)) return 1;
  const live = prices[key]?.[date];
  if (live != null) {
    lastPrice[key] = live;
    return live;
  }
  return lastPrice[key];
}
```

Now replace the inline `valuationPrice` closure (lines 35-42) with a thin wrapper that delegates to `navPriceForKey`. Find:
```ts
  function valuationPrice(key: string, date: string): number | undefined {
    const live = prices[key]?.[date];
    if (live != null) {
      lastPrice[key] = live;
      return live;
    }
    return lastPrice[key];
  }
```
Replace with:
```ts
  function valuationPrice(key: string, date: string): number | undefined {
    return navPriceForKey(key, date, prices, lastPrice);
  }
```

Next, update the rebalance loop (lines 62-88). Locate the block that begins with `for (const key of allKeys) {` and change the price-resolution section:

Current:
```ts
      for (const key of allKeys) {
        const price = prices[key]?.[date];
        if (price == null || price <= 0) continue;

        const currentShares = positions[key] ?? 0;
        const targetValue = portfolioValue * (targetWeights[key] ?? 0);
        const targetShares = targetValue / price;
        const delta = targetShares - currentShares;

        if (Math.abs(delta) <= EPSILON) continue;

        if (Math.abs(targetShares) <= EPSILON) {
          delete positions[key];
        } else {
          positions[key] = targetShares;
        }
        cash -= delta * price;

        trades.push({
          date,
          symbol: key.split(':')[0]!,
          quantity: Math.abs(delta),
          price,
          action: delta > 0 ? 'buy' : 'sell',
        });
      }
```

Replace with:
```ts
      for (const key of allKeys) {
        let price: number;
        if (isRateKey(key)) {
          price = 1;
        } else {
          const live = prices[key]?.[date];
          if (live == null || live <= 0) continue;
          price = live;
        }

        const currentShares = positions[key] ?? 0;
        const targetValue = portfolioValue * (targetWeights[key] ?? 0);
        const targetShares = targetValue / price;
        const delta = targetShares - currentShares;

        if (Math.abs(delta) <= EPSILON) continue;

        if (Math.abs(targetShares) <= EPSILON) {
          delete positions[key];
        } else {
          positions[key] = targetShares;
        }
        cash -= delta * price;

        trades.push({
          date,
          symbol: key.split(':')[0]!,
          quantity: Math.abs(delta),
          price,
          action: delta > 0 ? 'buy' : 'sell',
        });
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/backtest/simulate.test.ts`
Expected: all simulate tests pass (including the two new rate-ticker tests).

- [ ] **Step 5: Commit**

```bash
cd sdk && git add src/backtest/simulate.ts src/backtest/simulate.test.ts && git commit -m "$(cat <<'EOF'
feat(simulate): treat rate tickers as $1-priced in NAV and rebalance

Rate-ticker positions (DTB3, DFF) are valued at an implicit $1 per
share and their 'price' in the prices map is the annualized rate in
percent — used only for accrual (next commit). Rebalance into a
negative-weight DTB3 leg now produces a negative share count
representing borrowed cash.
EOF
)"
```

---

## Task 5: Simulator — daily accrual for rate-ticker positions

**Files:**
- Modify: `sdk/src/backtest/simulate.ts` (add accrual step; add `daysBetween` helper)
- Test: `sdk/src/backtest/simulate.test.ts`

- [ ] **Step 1: Write failing tests for accrual behavior**

Append to `sdk/src/backtest/simulate.test.ts` inside the `describe('runSimulation', ...)` block:

```ts
  it('accrues interest on rate-ticker positions per FRED 360-day convention', () => {
    const alloc = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    // Mon → Tue = 1 calendar day
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);
    const portfolio = stubPortfolio([
      [{ symbol: 'CASHX', leverage: 1 }, 0],
      [{ symbol: 'DTB3', leverage: 1 }, 100_000], // lent $100k
    ]);
    const prices = { 'DTB3:1': { '2025-01-06': 5.25, '2025-01-07': 5.25 } };

    const result = runSimulation(bars, prices, new Set(), portfolio);

    // Day 0: no accrual yet (first bar). NAV = 100_000.
    expect(result.series[0]!.value).toBeCloseTo(100_000, 2);
    // Day 1: positions *= 1 + 5.25/100 × 1/360 ≈ 1.00014583
    const expected = 100_000 * (1 + 0.0525 * 1 / 360);
    expect(result.series[1]!.value).toBeCloseTo(expected, 2);
  });

  it('accrues interest across weekend gaps (Fri → Mon = 3 days)', () => {
    const alloc = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    // 2025-01-03 is Fri, 2025-01-06 is Mon → 3 calendar days
    const bars = makeBars(['2025-01-03', '2025-01-06'], alloc);
    const portfolio = stubPortfolio([
      [{ symbol: 'CASHX', leverage: 1 }, 0],
      [{ symbol: 'DTB3', leverage: 1 }, 100_000],
    ]);
    const prices = { 'DTB3:1': { '2025-01-03': 5.25, '2025-01-06': 5.25 } };

    const result = runSimulation(bars, prices, new Set(), portfolio);

    const expected = 100_000 * (1 + 0.0525 * 3 / 360);
    expect(result.series[1]!.value).toBeCloseTo(expected, 2);
  });

  it('applies leverage multiplier to rate accrual', () => {
    const alloc = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06', '2025-01-07'], alloc);
    const portfolio = stubPortfolio([
      [{ symbol: 'CASHX', leverage: 1 }, 0],
      [{ symbol: 'DTB3', leverage: 2 }, 100_000], // DTB3?L=2, lent
    ]);
    const prices = { 'DTB3:2': { '2025-01-06': 5.25, '2025-01-07': 5.25 } };

    const result = runSimulation(bars, prices, new Set(), portfolio);

    // 2× accrual → 2 × 0.0525 × 1/360
    const expected = 100_000 * (1 + 2 * 0.0525 * 1 / 360);
    expect(result.series[1]!.value).toBeCloseTo(expected, 2);
  });

  it('skips accrual when rate is missing for the previous bar', () => {
    const alloc = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    const bars = makeBars(['2025-01-06', '2025-01-07', '2025-01-08'], alloc);
    const portfolio = stubPortfolio([
      [{ symbol: 'CASHX', leverage: 1 }, 0],
      [{ symbol: 'DTB3', leverage: 1 }, 100_000],
    ]);
    // Rate missing at 2025-01-06 → no accrual on step to 2025-01-07
    const prices = { 'DTB3:1': { '2025-01-07': 5.25 } };

    const result = runSimulation(bars, prices, new Set(), portfolio);

    expect(result.series[1]!.value).toBeCloseTo(100_000, 2); // unchanged
    // Next step uses 2025-01-07's rate for the 2025-01-07 → 2025-01-08 gap
    const expected = 100_000 * (1 + 0.0525 * 1 / 360);
    expect(result.series[2]!.value).toBeCloseTo(expected, 2);
  });

  it('rebalances out of a borrowed rate leg cleanly', () => {
    const allocBorrow = stubAllocation([
      [{ symbol: 'SPY', leverage: 1 }, 1.5],
      [{ symbol: 'DTB3', leverage: 1 }, -0.5],
    ]);
    const allocCash = stubAllocation([[{ symbol: 'CASHX', leverage: 1 }, 1.0]]);
    const bars: StrategyBar[] = [
      { date: '2025-01-06', allocation: allocBorrow },
      { date: '2025-01-07', allocation: allocCash },
    ];
    const prices = {
      'SPY:1': { '2025-01-06': 500, '2025-01-07': 500 }, // flat SPY
      'DTB3:1': { '2025-01-06': 0, '2025-01-07': 0 },     // 0% rate → no accrual effect
    };
    const rebalanceDates = new Set(['2025-01-06', '2025-01-07']);

    const result = runSimulation(bars, prices, rebalanceDates, cashPortfolio(100_000));

    // After day-2 rebalance: all cash, no positions.
    expect(result.finalPortfolio.holdings).toHaveLength(1);
    const [cashTicker, cashQty] = result.finalPortfolio.holdings[0]!;
    expect(cashTicker.symbol).toBe('CASHX');
    expect(cashQty).toBeCloseTo(100_000, 2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd sdk && npx vitest run src/backtest/simulate.test.ts -t "accrues\|leverage multiplier\|skips accrual\|rebalances out of a borrowed"`
Expected: FAIL — no accrual code exists yet; `series[1].value` will equal `series[0].value` (100_000).

- [ ] **Step 3: Add `daysBetween` helper and accrual step**

Edit `sdk/src/backtest/simulate.ts`. Add this helper near the other top-level helpers (after `isRateKey` / `navPriceForKey`):

```ts
function daysBetween(prevIsoDate: string, currIsoDate: string): number {
  // Both inputs are 'YYYY-MM-DD'. UTC midnight → diff in ms → days.
  const ms = Date.UTC(
    Number(currIsoDate.slice(0, 4)),
    Number(currIsoDate.slice(5, 7)) - 1,
    Number(currIsoDate.slice(8, 10)),
  ) - Date.UTC(
    Number(prevIsoDate.slice(0, 4)),
    Number(prevIsoDate.slice(5, 7)) - 1,
    Number(prevIsoDate.slice(8, 10)),
  );
  return Math.round(ms / (1000 * 60 * 60 * 24));
}
```

Now add the accrual logic inside `runSimulation`. Locate the main bar loop (currently starts at `for (const bar of bars) {` — around line 44). Add a `prevDate` tracker and an accrual block at the top of the loop.

Find:
```ts
  for (const bar of bars) {
    const date = bar.date;

    if (rebalanceDates.has(date)) {
```

Change to:
```ts
  let prevDate: string | null = null;
  for (const bar of bars) {
    const date = bar.date;

    // Accrue interest on rate-ticker positions between the previous bar and today.
    if (prevDate != null) {
      const days = daysBetween(prevDate, date);
      if (days > 0) {
        for (const [key, shares] of Object.entries(positions)) {
          if (!isRateKey(key)) continue;
          const ratePct = prices[key]?.[prevDate];
          if (ratePct == null) continue;
          const leverage = Number(key.slice(key.lastIndexOf(':') + 1)) || 1;
          const factor = 1 + leverage * (ratePct / 100) * (days / 360);
          positions[key] = shares * factor;
        }
      }
    }

    if (rebalanceDates.has(date)) {
```

At the end of the for loop body (find the `series.push({ date, value });` line, currently line 99), add `prevDate = date;` right after:

```ts
    series.push({ date, value });
    prevDate = date;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd sdk && npx vitest run src/backtest/simulate.test.ts`
Expected: all simulate tests pass.

- [ ] **Step 5: Full sdk test suite**

Run: `cd sdk && npx vitest run`
Expected: entire sdk suite green.

- [ ] **Step 6: Commit**

```bash
cd sdk && git add src/backtest/simulate.ts src/backtest/simulate.test.ts && git commit -m "$(cat <<'EOF'
feat(simulate): accrue daily interest on rate-ticker positions

Between consecutive bars, rate-ticker share counts compound by
(1 + L × rate% / 100 × days / 360) using the previous bar's rate.
Leverage applies as a multiplier on the accrual rate. Missing rate
→ no accrual for that step (balance unchanged).
EOF
)"
```

---

## Task 6: Integration verification

**Files:** No code changes. Runs the backtest CLI to confirm the 6 previously-failing strategies now succeed.

- [ ] **Step 1: Rebuild sdk and market packages**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/market && npm run build
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npm run build
```
Expected: both builds succeed.

- [ ] **Step 2: Confirm local supabase is running**

Run: `cd /Users/raksi/Documents/Personal/livefolio-2/storage && supabase status -o json | jq -r .SERVICE_ROLE_KEY`
Expected: a JWT string printed. If not, run `supabase start` first.

- [ ] **Step 3: Re-run the 6 failing strategies**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/cli
set -a; source .env; set +a
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_KEY=$(cd /Users/raksi/Documents/Personal/livefolio-2/storage && supabase status -o json | jq -r .SERVICE_ROLE_KEY)
npx tsx scripts/backtest-all.ts --from 2020-01-01 --to 2025-12-31 \
  --only 2gYdhZb9hgN,in3StwdSG57,aP4RycvnG3b,59iA4m6mfKm,icp6eVMQOGo,bqZ1J4pFLvD \
  --out backtest-financing-verify.csv
```
Expected: summary line reads `Summary: 6 ok, 0 failed`.

- [ ] **Step 4: Spot-check the rerun CSV**

```bash
awk -F',' 'NR>1 && $NF!="" { print $NF }' backtest-financing-verify.csv
```
Expected: no lines printed (no errors).

- [ ] **Step 5: Full 70-strategy rerun for regression check**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/cli
FAILED=$(awk -F',' 'NR>1 && $NF!="" { print $2 }' backtest-results-2026-04-18T14-15-28-701Z.csv | sort -u | paste -sd, -)
npx tsx scripts/backtest-all.ts --from 2020-01-01 --to 2025-12-31 --only "$FAILED" --out backtest-70-verify.csv
```
Expected: `Summary: 69 ok, 1 failed` (the 1 remaining is the malformed `gOkNooC30im` — `Allocation weights must sum to 1, got 0.475`, which is out of scope).

- [ ] **Step 6: No commit for this task** (verification only; no code change).
