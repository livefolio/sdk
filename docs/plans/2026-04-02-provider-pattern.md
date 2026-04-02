# Provider Pattern Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `@livefolio/sdk` from Supabase-coupled to pure logic with pluggable `StorageProvider` and `MarketProvider` interfaces.

**Architecture:** Define two provider interfaces. Replace all `this._supabase.from(...)` calls with `this._storage.*` calls and all Yahoo/FRED fetches with `this._market.fetchBars(...)`. Remove `@supabase/supabase-js`, `yahoo-finance2`, and `database.types.ts`. Update `createClient()` to accept `{ storage, market }`.

**Tech Stack:** TypeScript, Vitest, existing handle pattern

**Spec:** `sdk/docs/specs/2026-04-02-provider-pattern-design.md`

---

### Task 1: Define StorageProvider and MarketProvider interfaces

**Files:**
- Create: `sdk/src/providers/storage.ts`
- Create: `sdk/src/providers/market.ts`
- Create: `sdk/src/providers/types.ts`

- [ ] **Step 1: Create MarketProvider interface**

Create `sdk/src/providers/market.ts`:

```ts
import type { DailyBar } from '../handles/indicator.js';

export interface MarketProvider {
  fetchBars(symbol: string, from?: string): Promise<DailyBar[]>;
}
```

- [ ] **Step 2: Create supporting types**

Create `sdk/src/providers/types.ts`:

```ts
export type IndicatorType =
  | 'Price'
  | 'SMA'
  | 'EMA'
  | 'RSI'
  | 'Return'
  | 'Volatility'
  | 'Drawdown'
  | 'VIX'
  | 'VIX3M'
  | 'T3M'
  | 'T6M'
  | 'T1Y'
  | 'T2Y'
  | 'T3Y'
  | 'T5Y'
  | 'T7Y'
  | 'T10Y'
  | 'T20Y'
  | 'T30Y'
  | 'Month'
  | 'Day of Week'
  | 'Day of Month'
  | 'Day of Year'
  | 'Threshold';

export type TradingFreq = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';

export type Comparison = '>' | '<' | '=';

export type Unit = '%' | 'bps' | 'std';

export interface TickerIdentity {
  symbol: string;
  leverage: number;
}

export interface StrategySeriesEntry {
  date: string;
  allocationId: number;
}

export interface StrategyRuleDefinition {
  signalIds?: number[];
  allocationId: number;
}

export interface StrategyDefinition {
  linkId: string;
  name: string;
  freq: TradingFreq;
  offset: number;
  rules: StrategyRuleDefinition[];
}

export interface StrategyReferenceData {
  id: number;
  name: string;
  freq: TradingFreq;
  offset: number;
  rules: {
    signals: { id: number; indicatorId1: number; indicatorId2: number; comparison: Comparison; tolerance: number }[];
    allocations: { id: number; holdings: Record<string, number> }[];
    indicators: { id: number; type: IndicatorType; tickerId: number | null; lookback: number; delay: number; unit: Unit | null; threshold: number | null }[];
    tickers: { id: number; symbol: string; leverage: number }[];
    definition: StrategyRuleDefinition[];
  };
}
```

- [ ] **Step 3: Create StorageProvider interface**

Create `sdk/src/providers/storage.ts`:

```ts
import type { DailyBar, DateRange, IndicatorIdentity } from '../handles/indicator.js';
import type { SignalIdentity } from '../handles/signal.js';
import type { StrategyDefinition, StrategySeriesEntry, StrategyReferenceData } from './types.js';

export interface StorageProvider {
  tickers: {
    upsert(symbol: string, leverage: number): Promise<{ id: number }>;
  };

  indicators: {
    upsert(identity: {
      type: string;
      tickerId: number | null;
      lookback: number;
      delay: number;
      unit: string | null;
      threshold: number | null;
    }): Promise<{ id: number }>;
    getSeries(indicatorId: number, range?: DateRange): Promise<DailyBar[]>;
    writeSeries(indicatorId: number, bars: DailyBar[]): Promise<void>;
    getLatestSeriesDate(indicatorId: number): Promise<string | null>;
    getValue(indicatorId: number, date?: string): Promise<number | null>;
  };

  signals: {
    upsert(identity: {
      indicatorId1: number;
      indicatorId2: number;
      comparison: string;
      tolerance: number;
    }): Promise<{ id: number }>;
    getSeries(signalId: number, range?: DateRange): Promise<DailyBar[]>;
    writeSeries(signalId: number, bars: DailyBar[]): Promise<void>;
    getLatestSeriesDate(signalId: number): Promise<string | null>;
    getLastValue(signalId: number): Promise<number | null>;
  };

  allocations: {
    findOrCreate(holdings: Record<string, number>): Promise<{ id: number }>;
  };

  strategies: {
    create(definition: StrategyDefinition): Promise<{ id: number }>;
    getSeries(strategyId: number, range?: DateRange): Promise<StrategySeriesEntry[]>;
    writeSeries(strategyId: number, entries: StrategySeriesEntry[]): Promise<void>;
    getLatestSeriesDate(strategyId: number): Promise<string | null>;
    resolveReference(linkId: string): Promise<StrategyReferenceData>;
  };

  tradingDays: {
    getRange(range?: DateRange): Promise<string[]>;
    getLatestClosed(): Promise<string | null>;
  };
}
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean pass. New files have no consumers yet.

- [ ] **Step 5: Commit**

```bash
git add src/providers/storage.ts src/providers/market.ts src/providers/types.ts && git commit -m "feat(sdk): define StorageProvider and MarketProvider interfaces"
```

---

### Task 2: Update createClient and SDK types

**Files:**
- Modify: `sdk/src/client.ts`
- Modify: `sdk/src/client.test.ts`
- Modify: `sdk/src/index.ts`
- Delete: `sdk/src/types.ts`

- [ ] **Step 1: Update LivefolioClientOptions**

In `sdk/src/client.ts`, replace the imports and options:

Remove:
```ts
import type { Database } from './database.types.js';
import type { TypedSupabaseClient } from './types.js';
```

Add:
```ts
import type { StorageProvider } from './providers/storage.js';
import type { MarketProvider } from './providers/market.js';
```

Replace `IndicatorType`, `Unit`, `TreasuryTenor`, `CalendarPeriod` type aliases that reference `Database` with imports from the new types:

```ts
import type { IndicatorType, Unit, TradingFreq } from './providers/types.js';

type TreasuryTenor = Extract<
  IndicatorType,
  'T3M' | 'T6M' | 'T1Y' | 'T2Y' | 'T3Y' | 'T5Y' | 'T7Y' | 'T10Y' | 'T20Y' | 'T30Y'
>;
type CalendarPeriod = Extract<IndicatorType, 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year'>;
```

Replace `LivefolioClientOptions`:

```ts
export interface LivefolioClientOptions {
  storage: StorageProvider;
  market: MarketProvider;
}
```

Update `createClient` body — replace `sb` with `storage` and `market`, pass both to all handle constructors:

```ts
export function createClient(options: LivefolioClientOptions): LivefolioClient {
  const { storage, market } = options;

  return {
    ticker: (symbol, leverage) => new TickerHandle(storage, symbol, leverage),

    sma: (ticker, lookback, opts?) =>
      new IndicatorHandle(storage, market, {
        type: 'SMA', ticker, lookback, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),
    ema: (ticker, lookback, opts?) =>
      new IndicatorHandle(storage, market, {
        type: 'EMA', ticker, lookback, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),
    price: (ticker, opts?) =>
      new IndicatorHandle(storage, market, {
        type: 'Price', ticker, lookback: 0, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),
    returns: (ticker, lookback, opts?) =>
      new IndicatorHandle(storage, market, {
        type: 'Return', ticker, lookback, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),
    volatility: (ticker, lookback, opts?) =>
      new IndicatorHandle(storage, market, {
        type: 'Volatility', ticker, lookback, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),
    drawdown: (ticker, lookback, opts?) =>
      new IndicatorHandle(storage, market, {
        type: 'Drawdown', ticker, lookback, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),
    rsi: (ticker, lookback, opts?) =>
      new IndicatorHandle(storage, market, {
        type: 'RSI', ticker, lookback, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),

    vix: (opts?) =>
      new IndicatorHandle(storage, market, {
        type: 'VIX', ticker: null, lookback: 0, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),
    vix3m: (opts?) =>
      new IndicatorHandle(storage, market, {
        type: 'VIX3M', ticker: null, lookback: 0, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),
    treasury: (tenor, opts?) =>
      new IndicatorHandle(storage, market, {
        type: tenor, ticker: null, lookback: 0, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),
    calendar: (period, opts?) =>
      new IndicatorHandle(storage, market, {
        type: period, ticker: null, lookback: 0, delay: opts?.delay ?? 0, unit: null, threshold: null,
      }),

    threshold: (value, unit?) =>
      new IndicatorHandle(storage, market, {
        type: 'Threshold', ticker: null, lookback: 0, delay: 0, unit: unit ?? null, threshold: value,
      }),

    gt: (ind1, ind2, tolerance?) =>
      new SignalHandle(storage, market, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: tolerance ?? 0 }),
    lt: (ind1, ind2, tolerance?) =>
      new SignalHandle(storage, market, { indicator1: ind1, indicator2: ind2, comparison: '<', tolerance: tolerance ?? 0 }),
    eq: (ind1, ind2, tolerance?) =>
      new SignalHandle(storage, market, { indicator1: ind1, indicator2: ind2, comparison: '=', tolerance: tolerance ?? 0 }),

    allocation: (...holdings) => new AllocationHandle(storage, holdings),

    portfolio: (...holdings) => new PortfolioHandle(holdings),

    strategy: (optionsOrLinkId: StrategyOptions | string) => new StrategyHandle(storage, market, optionsOrLinkId),
  };
}
```

Note: The `tickerBound` and `standalone` helper functions can be removed — the factory methods now call constructors directly.

- [ ] **Step 2: Update client.test.ts**

Update the test to create a mock storage and market provider instead of a Supabase client. The tests should verify the same behavior (handle creation, property assignment) but with the new constructor signatures.

Replace the Supabase mock with:

```ts
const storage = {} as StorageProvider;
const market = {} as MarketProvider;
const client = createClient({ storage, market });
```

Update all assertions to match the new patterns. The tests primarily check that `client.ticker()`, `client.sma()`, etc. return correctly-typed handles.

- [ ] **Step 3: Update index.ts exports**

In `sdk/src/index.ts`:

Remove:
```ts
export type { TypedSupabaseClient, Database } from './types.js';
```

Add:
```ts
export type { StorageProvider } from './providers/storage.js';
export type { MarketProvider } from './providers/market.js';
export type { IndicatorType, TradingFreq, Comparison, Unit } from './providers/types.js';
```

- [ ] **Step 4: Delete src/types.ts**

```bash
rm sdk/src/types.ts
```

**Note:** Do NOT delete `database.types.ts` yet — other handles still import from it. That file is removed in Task 8 after all handles are migrated.

- [ ] **Step 5: Verify compilation fails only on handle files not yet migrated**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Errors only in handle files (ticker.ts, indicator.ts, signal.ts, allocation.ts, strategy.ts) that still reference the old types. client.ts should compile clean.

- [ ] **Step 6: Commit**

```bash
git add src/client.ts src/client.test.ts src/index.ts && git rm src/types.ts && git commit -m "refactor(sdk): update createClient to accept StorageProvider and MarketProvider"
```

---

### Task 3: Refactor TickerHandle

**Files:**
- Modify: `sdk/src/handles/ticker.ts`
- Modify: `sdk/src/handles/ticker.test.ts`

- [ ] **Step 1: Update TickerHandle to use StorageProvider**

Replace `sdk/src/handles/ticker.ts`:

```ts
import type { StorageProvider } from '../providers/storage.js';

export class TickerHandle {
  readonly symbol: string;
  readonly leverage: number;

  private _storage: StorageProvider;
  private _resolvedId: number | null = null;
  private _resolving: Promise<{ id: number }> | null = null;

  constructor(storage: StorageProvider, symbol: string, leverage: number = 1) {
    this._storage = storage;
    this.symbol = symbol.toUpperCase();
    this.leverage = leverage;
  }

  get id(): number {
    if (this._resolvedId == null)
      throw new Error('TickerHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolvedId;
  }

  async resolve(): Promise<{ id: number }> {
    if (this._resolvedId != null) return { id: this._resolvedId };
    if (!this._resolving) this._resolving = this._doResolve();
    return this._resolving;
  }

  static fromResolved(storage: StorageProvider, id: number, symbol: string, leverage: number): TickerHandle {
    const handle = new TickerHandle(storage, symbol, leverage);
    handle._resolvedId = id;
    return handle;
  }

  private async _doResolve(): Promise<{ id: number }> {
    const result = await this._storage.tickers.upsert(this.symbol, this.leverage);
    this._resolvedId = result.id;
    return result;
  }
}
```

Key changes:
- `_supabase: TypedSupabaseClient` → `_storage: StorageProvider`
- `_resolved: TickerRow` → `_resolvedId: number`
- `_doResolve()` calls `this._storage.tickers.upsert()` instead of Supabase chain
- `fromRow()` renamed to `fromResolved()` — takes `id, symbol, leverage` directly instead of a row
- No import of `database.types.ts`

- [ ] **Step 2: Update ticker.test.ts**

Replace Supabase mocks with StorageProvider mocks:

```ts
import { describe, it, expect, vi } from 'vitest';
import { TickerHandle } from './ticker.js';
import type { StorageProvider } from '../providers/storage.js';

function mockStorage(overrides?: Partial<StorageProvider>): StorageProvider {
  return {
    tickers: {
      upsert: vi.fn().mockResolvedValue({ id: 42 }),
      ...overrides?.tickers,
    },
    indicators: {} as StorageProvider['indicators'],
    signals: {} as StorageProvider['signals'],
    allocations: {} as StorageProvider['allocations'],
    strategies: {} as StorageProvider['strategies'],
    tradingDays: {} as StorageProvider['tradingDays'],
    ...overrides,
  };
}

describe('TickerHandle', () => {
  it('stores symbol and leverage', () => {
    const storage = mockStorage();
    const handle = new TickerHandle(storage, 'spy', 1);
    expect(handle.symbol).toBe('SPY');
    expect(handle.leverage).toBe(1);
  });

  it('defaults leverage to 1', () => {
    const storage = mockStorage();
    const handle = new TickerHandle(storage, 'SPY');
    expect(handle.leverage).toBe(1);
  });

  it('throws on .id before resolution', () => {
    const storage = mockStorage();
    const handle = new TickerHandle(storage, 'SPY');
    expect(() => handle.id).toThrow('not yet resolved');
  });

  it('resolves via storage provider', async () => {
    const storage = mockStorage();
    const handle = new TickerHandle(storage, 'SPY');
    const result = await handle.resolve();
    expect(result.id).toBe(42);
    expect(handle.id).toBe(42);
    expect(storage.tickers.upsert).toHaveBeenCalledWith('SPY', 1);
  });

  it('caches resolution', async () => {
    const storage = mockStorage();
    const handle = new TickerHandle(storage, 'SPY');
    await handle.resolve();
    await handle.resolve();
    expect(storage.tickers.upsert).toHaveBeenCalledTimes(1);
  });

  it('creates pre-resolved handle via fromResolved', () => {
    const storage = mockStorage();
    const handle = TickerHandle.fromResolved(storage, 42, 'SPY', 1);
    expect(handle.id).toBe(42);
    expect(handle.symbol).toBe('SPY');
    expect(handle.leverage).toBe(1);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/handles/ticker.test.ts --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/handles/ticker.ts src/handles/ticker.test.ts && git commit -m "refactor(sdk): migrate TickerHandle to StorageProvider"
```

---

### Task 4: Refactor AllocationHandle

**Files:**
- Modify: `sdk/src/handles/allocation.ts`
- Modify: `sdk/src/handles/allocation.test.ts`

- [ ] **Step 1: Update AllocationHandle to use StorageProvider**

Key changes to `sdk/src/handles/allocation.ts`:

- Remove imports of `TypedSupabaseClient`, `Tables`, `database.types.js`
- Add `import type { StorageProvider } from '../providers/storage.js';`
- Constructor: `constructor(storage: StorageProvider, holdings: [TickerHandle, number][])`
- `_supabase: TypedSupabaseClient` → `_storage: StorageProvider`
- `_resolved: AllocationRow | null` → `_resolvedId: number | null`
- `_doResolve()`: build `holdingsJson` same as before, then call `this._storage.allocations.findOrCreate(holdingsJson)` instead of the two-phase Supabase select/insert
- `fromRow()` renamed to `fromResolved()`: takes `storage, id, holdings` (where holdings is `[TickerHandle, number][]`) — no longer needs to parse JSON from a row

```ts
import type { StorageProvider } from '../providers/storage.js';
import { TickerHandle } from './ticker.js';

export class AllocationHandle {
  readonly holdings: [TickerHandle, number][];

  private _storage: StorageProvider;
  private _resolvedId: number | null = null;
  private _resolving: Promise<{ id: number }> | null = null;

  constructor(storage: StorageProvider, holdings: [TickerHandle, number][]) {
    const total = holdings.reduce((sum, [, weight]) => sum + weight, 0);
    if (Math.abs(total - 1) > 1e-9) {
      throw new Error(`Allocation weights must sum to 1, got ${total}`);
    }
    this._storage = storage;
    this.holdings = holdings;
  }

  get id(): number {
    if (this._resolvedId == null)
      throw new Error('AllocationHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolvedId;
  }

  async resolve(): Promise<{ id: number }> {
    if (this._resolvedId != null) return { id: this._resolvedId };
    if (!this._resolving) this._resolving = this._doResolve();
    return this._resolving;
  }

  static fromResolved(storage: StorageProvider, id: number, holdings: [TickerHandle, number][]): AllocationHandle {
    const handle = new AllocationHandle(storage, holdings);
    handle._resolvedId = id;
    return handle;
  }

  private async _doResolve(): Promise<{ id: number }> {
    await Promise.all(this.holdings.map(([ticker]) => ticker.resolve()));

    const holdingsJson: Record<string, number> = {};
    for (const [ticker, weight] of this.holdings) {
      const key = ticker.leverage !== 1 ? `${ticker.symbol}?L=${ticker.leverage}` : ticker.symbol;
      holdingsJson[key] = weight;
    }

    const result = await this._storage.allocations.findOrCreate(holdingsJson);
    this._resolvedId = result.id;
    return result;
  }
}
```

- [ ] **Step 2: Update allocation.test.ts**

Replace Supabase mocks with StorageProvider mocks. Same `mockStorage()` pattern as Task 3. Tests verify:
- Weight validation (sum to 1)
- `resolve()` calls `storage.allocations.findOrCreate()` with correct JSON
- `id` throws before resolution
- `fromResolved()` creates pre-resolved handle
- Caches resolution

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/handles/allocation.test.ts --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/handles/allocation.ts src/handles/allocation.test.ts && git commit -m "refactor(sdk): migrate AllocationHandle to StorageProvider"
```

---

### Task 5: Refactor IndicatorHandle

This is the largest handle. The refactor pattern is mechanical but touches many methods.

**Files:**
- Modify: `sdk/src/handles/indicator.ts`
- Modify: `sdk/src/handles/indicator.test.ts`

- [ ] **Step 1: Update IndicatorHandle constructor and imports**

In `sdk/src/handles/indicator.ts`:

Remove:
```ts
import type { TypedSupabaseClient } from '../types.js';
import type { Tables, Database } from '../database.types.js';
import { fetchYahoo } from '../providers/yahoo.js';
import { fetchFred } from '../providers/fred.js';
```

Add:
```ts
import type { StorageProvider } from '../providers/storage.js';
import type { MarketProvider } from '../providers/market.js';
import type { IndicatorType, Unit } from '../providers/types.js';
```

Remove the `Database`-derived type aliases:
```ts
type IndicatorRow = Tables<'indicators'>;
type IndicatorType = Database['public']['Enums']['indicator_type'];
type Unit = Database['public']['Enums']['unit'];
```

Update constructor:
```ts
constructor(storage: StorageProvider, market: MarketProvider, identity: IndicatorIdentity) {
  this._storage = storage;
  this._market = market;
  // ... same field assignments
}
```

Replace `_supabase` with `_storage` and `_market`. Remove `_config: IndicatorConfig` — the FRED API key was only needed for `fetchFred()` which is now in the market provider.

Remove `IndicatorConfig` interface entirely — it only existed for `fredApiKey`.

- [ ] **Step 2: Update resolve methods**

`_doResolve()`: Replace Supabase upsert with:
```ts
private async _doResolve(): Promise<{ id: number }> {
  const tickerId = this.ticker ? (await this.ticker.resolve()).id : null;
  const result = await this._storage.indicators.upsert({
    type: this.type,
    tickerId,
    lookback: this.lookback,
    delay: this.delay,
    unit: this.unit,
    threshold: this.threshold,
  });
  this._resolvedId = result.id;
  return result;
}
```

`fromRow()` → `fromResolved()`:
```ts
static fromResolved(
  storage: StorageProvider,
  market: MarketProvider,
  id: number,
  identity: IndicatorIdentity,
): IndicatorHandle {
  const handle = new IndicatorHandle(storage, market, identity);
  handle._resolvedId = id;
  return handle;
}
```

- [ ] **Step 3: Update freshness and sync methods**

Replace every `this._supabase` call:

`_getLatestClosedTradingDay()` →
```ts
private async _getLatestClosedTradingDay(): Promise<string> {
  const date = await this._storage.tradingDays.getLatestClosed();
  if (!date) throw new Error('No closed trading days found');
  return date;
}
```

`_getLatestSeriesDate()` →
```ts
private async _getLatestSeriesDate(indicatorId: number): Promise<string | null> {
  return this._storage.indicators.getLatestSeriesDate(indicatorId);
}
```

`_upsertSeries()` →
```ts
private async _upsertSeries(bars: DailyBar[]): Promise<void> {
  const { id } = await this.resolve();
  await this._storage.indicators.writeSeries(id, bars);
}
```

`_querySeriesFromDb()` →
```ts
private async _querySeriesFromDb(range?: DateRange): Promise<DailyBar[]> {
  const { id } = await this.resolve();
  return this._storage.indicators.getSeries(id, range);
}
```

`_syntheticThresholdSeries()` →
```ts
private async _syntheticThresholdSeries(range?: DateRange): Promise<DailyBar[]> {
  const v = this.threshold!;
  const dates = await this._storage.tradingDays.getRange(range);
  return dates.map((date) => ({ date, value: v }));
}
```

`value()` →
```ts
async value(date?: string): Promise<number | null> {
  await this._ensureFresh();
  const { id } = await this.resolve();
  return this._storage.indicators.getValue(id, date);
}
```

- [ ] **Step 4: Update _sync() — replace yahoo/fred with market.fetchBars()**

The `_sync()` method routes by provider type. Replace the switch:

```ts
private async _sync(fromDate: string | undefined, latestClosed: string): Promise<void> {
  const tickerSymbol = this.ticker?.symbol ?? null;
  const info = getProviderInfo(this.type, tickerSymbol);

  let bars: DailyBar[];

  switch (info.provider) {
    case 'yahoo':
      bars = await this._market.fetchBars(info.symbol, fromDate);
      break;

    case 'fred':
      bars = await this._market.fetchBars(info.seriesId, fromDate);
      break;

    case 'computed': {
      const priceHandle = new IndicatorHandle(
        this._storage,
        this._market,
        { type: 'Price', ticker: this.ticker, lookback: 0, delay: 0, unit: null, threshold: null },
      );
      await priceHandle._ensureFresh();
      const priceBars = await priceHandle._querySeriesFromDb();
      const computeFn = getComputation(this.type);
      if (!computeFn) throw new Error(`No computation found for type "${this.type}"`);
      bars = computeFn(priceBars, this.lookback);
      if (fromDate) bars = bars.filter((b) => b.date > fromDate);
      break;
    }

    case 'calendar': {
      const allDays = await this._storage.tradingDays.getRange();
      const dayBars: DailyBar[] = allDays.map((date) => ({ date, value: 0 }));
      bars = computeCalendar(dayBars, this.type as 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year');
      if (fromDate) bars = bars.filter((b) => b.date > fromDate);
      break;
    }

    case 'none':
      return;
  }

  // Apply leverage (unchanged)
  const leverage = this.ticker?.leverage ?? 1;
  if (leverage !== 1 && info.provider !== 'computed' && bars.length > 0) {
    const leveraged: DailyBar[] = [bars[0]];
    for (let i = 1; i < bars.length; i++) {
      const dailyReturn = (bars[i].value - bars[i - 1].value) / bars[i - 1].value;
      const prev = leveraged[i - 1].value;
      leveraged.push({ date: bars[i].date, value: prev * (1 + leverage * dailyReturn) });
    }
    bars = leveraged;
  }

  bars = bars.filter((b) => b.date <= latestClosed);

  if (bars.length > 0) {
    await this._upsertSeries(bars);
  }
}
```

Key changes: `fetchYahoo(symbol, from)` → `this._market.fetchBars(symbol, from)`, `fetchFred(seriesId, apiKey, from)` → `this._market.fetchBars(seriesId, from)`, calendar trading days fetched via `this._storage.tradingDays.getRange()`.

- [ ] **Step 5: Update indicator.test.ts**

Replace all Supabase mocking with `StorageProvider` and `MarketProvider` mocks. The tests verify the same behaviors but through the provider interfaces.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/handles/indicator.test.ts --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/handles/indicator.ts src/handles/indicator.test.ts && git commit -m "refactor(sdk): migrate IndicatorHandle to StorageProvider and MarketProvider"
```

---

### Task 6: Refactor SignalHandle

**Files:**
- Modify: `sdk/src/handles/signal.ts`
- Modify: `sdk/src/handles/signal.test.ts`

- [ ] **Step 1: Update SignalHandle to use providers**

Same pattern as IndicatorHandle. Key changes in `sdk/src/handles/signal.ts`:

- Remove `TypedSupabaseClient`, `Tables`, `Database` imports
- Add `StorageProvider` and `MarketProvider` imports
- Constructor: `constructor(storage: StorageProvider, market: MarketProvider, identity: SignalIdentity)`
- `_supabase` → `_storage`, add `_market`
- Remove `_config: IndicatorConfig`
- `_resolved: SignalRow` → `_resolvedId: number`

Replace Supabase calls:

`_doResolve()` →
```ts
const [ind1, ind2] = await Promise.all([this.indicator1.resolve(), this.indicator2.resolve()]);
const result = await this._storage.signals.upsert({
  indicatorId1: ind1.id,
  indicatorId2: ind2.id,
  comparison: this.comparison,
  tolerance: this.tolerance,
});
this._resolvedId = result.id;
return result;
```

`_getLatestClosedTradingDay()` → `this._storage.tradingDays.getLatestClosed()`

`_getLatestSignalSeriesDate()` → `this._storage.signals.getLatestSeriesDate(signalId)`

`_getLastSignalValue()` → `this._storage.signals.getLastValue(signalId)`

`_upsertSeries()` → `this._storage.signals.writeSeries(id, bars)`

`_querySeriesFromDb()` → `this._storage.signals.getSeries(id, range)`

`value()` → delegate to `this._storage.signals.getLastValue()` or `getSeries()` with date filter

`fromRow()` → `fromResolved()` taking `storage, market, id, identity`

- [ ] **Step 2: Update signal.test.ts**

Replace Supabase mocks with provider mocks.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/handles/signal.test.ts --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/handles/signal.ts src/handles/signal.test.ts && git commit -m "refactor(sdk): migrate SignalHandle to StorageProvider and MarketProvider"
```

---

### Task 7: Refactor StrategyHandle

**Files:**
- Modify: `sdk/src/handles/strategy.ts`
- Modify: `sdk/src/handles/strategy.test.ts`
- Modify: `sdk/src/handles/strategy-simulate.test.ts`

- [ ] **Step 1: Update StrategyHandle to use providers**

Key changes in `sdk/src/handles/strategy.ts`:

- Remove `TypedSupabaseClient`, `Tables`, `Database` imports
- Add `StorageProvider`, `MarketProvider` imports
- Add `import type { TradingFreq } from '../providers/types.js';`
- Constructor: `constructor(storage: StorageProvider, market: MarketProvider, optionsOrLinkId: StrategyOptions | string)`
- `_supabase` → `_storage`, add `_market`
- Remove `_config: IndicatorConfig`

Replace Supabase calls:

`_doResolveCreate()` → Build definition, call `this._storage.strategies.create(definition)`:
```ts
const result = await this._storage.strategies.create({
  linkId: nanoid(),
  name: this._name!,
  freq: this._freq,
  offset: this._offset,
  rules: this._rules.map((rule) => ({
    signalIds: (rule.when ?? []).map((s) => s.id),
    allocationId: rule.hold.id,
  })),
});
this._resolvedId = result.id;
```

`_doResolveReference()` → Call `this._storage.strategies.resolveReference(linkId)` which returns `StrategyReferenceData`. Reconstruct handles from the returned data:
```ts
private async _doResolveReference(): Promise<{ id: number }> {
  const ref = await this._storage.strategies.resolveReference(this._linkId!);
  this._resolvedId = ref.id;
  this._name = ref.name;
  this._freq = ref.freq;
  this._offset = ref.offset;

  // Build handles from reference data
  const tickerMap = new Map<number, TickerHandle>();
  for (const t of ref.rules.tickers) {
    tickerMap.set(t.id, TickerHandle.fromResolved(this._storage, t.id, t.symbol, t.leverage));
  }

  const indicatorMap = new Map<number, IndicatorHandle>();
  for (const ind of ref.rules.indicators) {
    const ticker = ind.tickerId ? (tickerMap.get(ind.tickerId) ?? null) : null;
    indicatorMap.set(ind.id, IndicatorHandle.fromResolved(this._storage, this._market, ind.id, {
      type: ind.type, ticker, lookback: ind.lookback, delay: ind.delay, unit: ind.unit, threshold: ind.threshold,
    }));
  }

  const signalMap = new Map<number, SignalHandle>();
  for (const sig of ref.rules.signals) {
    signalMap.set(sig.id, SignalHandle.fromResolved(this._storage, this._market, sig.id, {
      indicator1: indicatorMap.get(sig.indicatorId1)!,
      indicator2: indicatorMap.get(sig.indicatorId2)!,
      comparison: sig.comparison,
      tolerance: sig.tolerance,
    }));
  }

  const allocationMap = new Map<number, AllocationHandle>();
  for (const alloc of ref.rules.allocations) {
    const holdings: [TickerHandle, number][] = Object.entries(alloc.holdings).map(([key, weight]) => {
      const match = key.match(/^(.+)\?L=(.+)$/);
      const symbol = match ? match[1] : key;
      const leverage = match ? Number(match[2]) : 1;
      return [TickerHandle.fromResolved(this._storage, 0, symbol, leverage), weight];
    });
    const handle = AllocationHandle.fromResolved(this._storage, alloc.id, holdings);
    allocationMap.set(alloc.id, handle);
    this._allocationMap.set(alloc.id, handle);
  }

  this._rules = ref.rules.definition.map((rule) => ({
    when: rule.signalIds && rule.signalIds.length > 0 ? rule.signalIds.map((id) => signalMap.get(id)!) : undefined,
    hold: allocationMap.get(rule.allocationId)!,
  }));

  return { id: ref.id };
}
```

`_sync()` → Replace `this._supabase.from('trading_days')` with `this._storage.tradingDays.getRange()` and `this._supabase.from('strategies_series').upsert(...)` with `this._storage.strategies.writeSeries(id, entries)`.

`_querySeriesFromDb()` → `this._storage.strategies.getSeries(id, range)` — but this returns `StrategySeriesEntry[]` (date + allocationId) which needs to be mapped to `StrategyBar[]` using `this._allocationMap`.

`_fetchPricesForTickers()` — uses `IndicatorHandle` which is already migrated. Just update the constructor call to pass `this._storage, this._market` instead of `this._supabase`.

`_fetchRawClosePrices()` — same pattern: create `TickerHandle(this._storage, ...)` and `IndicatorHandle(this._storage, this._market, ...)`.

- [ ] **Step 2: Update strategy.test.ts and strategy-simulate.test.ts**

Replace all Supabase mocks with provider mocks.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/handles/strategy.test.ts src/handles/strategy-simulate.test.ts --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/handles/strategy.ts src/handles/strategy.test.ts src/handles/strategy-simulate.test.ts && git commit -m "refactor(sdk): migrate StrategyHandle to StorageProvider and MarketProvider"
```

---

### Task 8: Update mappings, remove Supabase files, update remaining tests

**Files:**
- Modify: `sdk/src/providers/mappings.ts`
- Modify: `sdk/src/handles/fromRow.test.ts`
- Modify: `sdk/src/handles/sync.test.ts`
- Modify: `sdk/src/handles/portfolio.ts` (verify no Supabase imports — should be clean already)
- Delete: `sdk/src/database.types.ts`
- Delete: `sdk/src/providers/yahoo.ts`
- Delete: `sdk/src/providers/fred.ts`
- Modify: `sdk/package.json` — remove `@supabase/supabase-js` peer dep and `yahoo-finance2` dep

- [ ] **Step 1: Update mappings.ts**

Remove the `Database` import and type alias. Use the string union from `providers/types.ts`:

```ts
import type { IndicatorType } from './types.js';

export type ProviderInfo =
  | { provider: 'yahoo'; symbol: string }
  | { provider: 'fred'; seriesId: string }
  | { provider: 'computed'; dependsOn: 'Price'; symbol: string }
  | { provider: 'calendar' }
  | { provider: 'none' };

// ... rest unchanged (FRED_SERIES, COMPUTED_TYPES, CALENDAR_TYPES, getProviderInfo)
```

Update `getProviderInfo` signature:
```ts
export function getProviderInfo(type: IndicatorType, tickerSymbol: string | null): ProviderInfo {
```

- [ ] **Step 2: Update or remove fromRow.test.ts**

The `fromRow` tests verify `TickerHandle.fromRow()`, `IndicatorHandle.fromRow()`, `AllocationHandle.fromRow()`, `SignalHandle.fromRow()`. These are now `fromResolved()` methods with different signatures. Update tests to use the new static factory methods.

- [ ] **Step 3: Update sync.test.ts**

This test file tests the indicator sync chain. Update Supabase mocks to provider mocks.

- [ ] **Step 4: Delete Supabase-specific files**

```bash
rm src/database.types.ts src/providers/yahoo.ts src/providers/fred.ts
```

- [ ] **Step 5: Update package.json**

Remove from `peerDependencies`:
```json
"@supabase/supabase-js": "^2"
```

Remove from `dependencies`:
```json
"yahoo-finance2": "^2"
```

- [ ] **Step 6: Run npm install to update lockfile**

```bash
npm install
```

- [ ] **Step 7: Update backtest test files**

Update `src/backtest/simulate.test.ts` and `src/backtest/push.test.ts` — these stub `TickerHandle` and `AllocationHandle` with `as` casts. If the cast targets changed (e.g., removed fields), update the stubs. These should be minimal changes since the stubs only read `.symbol`, `.leverage`, and `.holdings`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "refactor(sdk): remove Supabase and Yahoo deps, clean up provider migration"
```

---

### Task 9: Final verification

**Files:** All

- [ ] **Step 1: Run linter**

Run: `npx eslint src/ --fix`
Expected: Clean or auto-fixed.

- [ ] **Step 2: Run formatter**

Run: `npx prettier --write "src/**/*.ts"`
Expected: Files formatted.

- [ ] **Step 3: Verify no remaining Supabase references**

Run: `grep -r "supabase" src/ --include="*.ts" -l`
Expected: No files found (or only in comments/docs).

Run: `grep -r "database.types" src/ --include="*.ts" -l`
Expected: No files found.

Run: `grep -r "fetchYahoo\|fetchFred" src/ --include="*.ts" -l`
Expected: No files found.

- [ ] **Step 4: Run full build**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: All tests PASS.

- [ ] **Step 6: Verify package.json has no Supabase or Yahoo deps**

Run: `cat package.json | grep -E "supabase|yahoo"`
Expected: No matches.

- [ ] **Step 7: Commit if any formatting/lint changes**

```bash
git add -A && git diff --cached --quiet || git commit -m "style(sdk): lint and format after provider pattern migration"
```
