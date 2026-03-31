# Lazy Handle API — Tickers & Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement lazy handle classes for tickers and indicators with type-specific factory methods on the SDK client.

**Architecture:** Two handle classes (`TickerHandle`, `IndicatorHandle`) that store identity params and defer DB upserts until `.resolve()`, `.value()`, or `.series()` is called. Factory methods on the client (`sdk.ticker()`, `sdk.sma()`, etc.) construct handles with correct defaults. Resolution is memoized per instance.

**Tech Stack:** TypeScript, Supabase JS client, Vitest

---

## File Structure

```
sdk/src/
  handles/
    ticker.ts          # TickerHandle class
    indicator.ts       # IndicatorHandle class + factory helpers
    index.ts           # barrel export
  database.types.ts    # generated (exists, no changes)
  types.ts             # updated: remove old LivefolioClient, add handle-related types
  client.ts            # new: createClient + all factory methods
  index.ts             # updated: re-export from client.ts instead of types.ts
```

---

### Task 1: TickerHandle

**Files:**
- Create: `src/handles/ticker.ts`
- Test: `src/handles/ticker.test.ts`

- [ ] **Step 1: Write the failing test for TickerHandle construction**

```ts
// src/handles/ticker.test.ts
import { describe, it, expect } from 'vitest';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

function mockSupabase() {
  return {} as TypedSupabaseClient;
}

describe('TickerHandle', () => {
  it('stores symbol and leverage', () => {
    const handle = new TickerHandle(mockSupabase(), 'SPY', 1);
    expect(handle.symbol).toBe('SPY');
    expect(handle.leverage).toBe(1);
  });

  it('defaults leverage to 1', () => {
    const handle = new TickerHandle(mockSupabase(), 'SPY');
    expect(handle.leverage).toBe(1);
  });

  it('throws on .id before resolution', () => {
    const handle = new TickerHandle(mockSupabase(), 'SPY');
    expect(() => handle.id).toThrow('not yet resolved');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/handles/ticker.test.ts`
Expected: FAIL — cannot find `./ticker.js`

- [ ] **Step 3: Implement TickerHandle**

```ts
// src/handles/ticker.ts
import type { TypedSupabaseClient } from '../types.js';
import type { Tables } from '../database.types.js';

type TickerRow = Tables<'tickers'>;

export class TickerHandle {
  readonly symbol: string;
  readonly leverage: number;

  private _supabase: TypedSupabaseClient;
  private _resolved: TickerRow | null = null;

  constructor(supabase: TypedSupabaseClient, symbol: string, leverage: number = 1) {
    this._supabase = supabase;
    this.symbol = symbol;
    this.leverage = leverage;
  }

  get id(): number {
    if (!this._resolved) throw new Error('TickerHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolved.id;
  }

  async resolve(): Promise<TickerRow> {
    if (this._resolved) return this._resolved;

    const { data, error } = await this._supabase
      .from('tickers')
      .upsert(
        { symbol: this.symbol, leverage: this.leverage },
        { onConflict: 'symbol,leverage' },
      )
      .select()
      .single();

    if (error) throw error;
    this._resolved = data;
    return data;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/handles/ticker.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for resolve()**

```ts
// Append to src/handles/ticker.test.ts
import { vi } from 'vitest';

function mockSupabaseWithUpsert(row: Record<string, unknown>) {
  const single = vi.fn().mockResolvedValue({ data: row, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const upsert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ upsert });
  return { from } as unknown as TypedSupabaseClient;
}

describe('TickerHandle.resolve', () => {
  it('upserts and returns the row', async () => {
    const row = { id: 42, symbol: 'SPY', leverage: 1, created_at: '2026-01-01T00:00:00Z' };
    const sb = mockSupabaseWithUpsert(row);
    const handle = new TickerHandle(sb, 'SPY', 1);

    const result = await handle.resolve();

    expect(result).toEqual(row);
    expect(handle.id).toBe(42);
    expect(sb.from).toHaveBeenCalledWith('tickers');
  });

  it('caches the result on subsequent calls', async () => {
    const row = { id: 42, symbol: 'SPY', leverage: 1, created_at: '2026-01-01T00:00:00Z' };
    const sb = mockSupabaseWithUpsert(row);
    const handle = new TickerHandle(sb, 'SPY', 1);

    await handle.resolve();
    await handle.resolve();

    expect(sb.from).toHaveBeenCalledTimes(1);
  });

  it('propagates errors', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS denied' } });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });
    const sb = { from } as unknown as TypedSupabaseClient;

    const handle = new TickerHandle(sb, 'SPY');
    await expect(handle.resolve()).rejects.toEqual({ message: 'RLS denied' });
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/handles/ticker.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add src/handles/ticker.ts src/handles/ticker.test.ts
git commit -m "feat: add TickerHandle with lazy resolution"
```

---

### Task 2: IndicatorHandle

**Files:**
- Create: `src/handles/indicator.ts`
- Test: `src/handles/indicator.test.ts`

- [ ] **Step 1: Write the failing test for IndicatorHandle construction**

```ts
// src/handles/indicator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { IndicatorHandle } from './indicator.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

function mockSupabase() {
  return {} as TypedSupabaseClient;
}

describe('IndicatorHandle', () => {
  it('stores identity params with a ticker', () => {
    const sb = mockSupabase();
    const ticker = new TickerHandle(sb, 'SPY');
    const handle = new IndicatorHandle(sb, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });

    expect(handle.type).toBe('SMA');
    expect(handle.ticker).toBe(ticker);
    expect(handle.lookback).toBe(200);
  });

  it('stores identity params without a ticker', () => {
    const sb = mockSupabase();
    const handle = new IndicatorHandle(sb, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    expect(handle.type).toBe('VIX');
    expect(handle.ticker).toBeNull();
  });

  it('throws on .id before resolution', () => {
    const sb = mockSupabase();
    const handle = new IndicatorHandle(sb, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    expect(() => handle.id).toThrow('not yet resolved');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/handles/indicator.test.ts`
Expected: FAIL — cannot find `./indicator.js`

- [ ] **Step 3: Implement IndicatorHandle**

```ts
// src/handles/indicator.ts
import type { TypedSupabaseClient } from '../types.js';
import type { Tables, Database } from '../database.types.js';
import type { TickerHandle } from './ticker.js';

type IndicatorRow = Tables<'indicators'>;
type IndicatorSeriesRow = Tables<'indicators_series'>;
type IndicatorType = Database['public']['Enums']['indicator_type'];
type Unit = Database['public']['Enums']['unit'];

export interface IndicatorIdentity {
  type: IndicatorType;
  ticker: TickerHandle | null;
  lookback: number;
  delay: number;
  unit: Unit | null;
  threshold: number | null;
}

export interface DateRange {
  from?: string;
  to?: string;
}

export class IndicatorHandle {
  readonly type: IndicatorType;
  readonly ticker: TickerHandle | null;
  readonly lookback: number;
  readonly delay: number;
  readonly unit: Unit | null;
  readonly threshold: number | null;

  private _supabase: TypedSupabaseClient;
  private _resolved: IndicatorRow | null = null;

  constructor(supabase: TypedSupabaseClient, identity: IndicatorIdentity) {
    this._supabase = supabase;
    this.type = identity.type;
    this.ticker = identity.ticker;
    this.lookback = identity.lookback;
    this.delay = identity.delay;
    this.unit = identity.unit;
    this.threshold = identity.threshold;
  }

  get id(): number {
    if (!this._resolved) throw new Error('IndicatorHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolved.id;
  }

  async resolve(): Promise<IndicatorRow> {
    if (this._resolved) return this._resolved;

    const tickerId = this.ticker ? (await this.ticker.resolve()).id : null;

    const { data, error } = await this._supabase
      .from('indicators')
      .upsert(
        {
          type: this.type,
          ticker_id: tickerId,
          lookback: this.lookback,
          delay: this.delay,
          unit: this.unit,
          threshold: this.threshold,
        },
        { onConflict: 'type,ticker_id,lookback,delay,unit,threshold' },
      )
      .select()
      .single();

    if (error) throw error;
    this._resolved = data;
    return data;
  }

  async series(range?: DateRange): Promise<IndicatorSeriesRow[]> {
    const row = await this.resolve();
    let query = this._supabase
      .from('indicators_series')
      .select('*, trading_days!inner(date)')
      .eq('indicator_id', row.id)
      .order('trading_day_id', { ascending: true });

    if (range?.from) query = query.gte('trading_days.date', range.from);
    if (range?.to) query = query.lte('trading_days.date', range.to);

    const { data, error } = await query;
    if (error) throw error;
    return data as IndicatorSeriesRow[];
  }

  async value(date?: string): Promise<number | null> {
    const row = await this.resolve();
    let query = this._supabase
      .from('indicators_series')
      .select('value, trading_days!inner(date)')
      .eq('indicator_id', row.id)
      .order('trading_day_id', { ascending: false })
      .limit(1);

    if (date) query = query.eq('trading_days.date', date);

    const { data, error } = await query.single();
    if (error?.code === 'PGRST116') return null; // no rows
    if (error) throw error;
    return data.value;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/handles/indicator.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for resolve() with ticker dependency**

```ts
// Append to src/handles/indicator.test.ts

function mockSupabaseChained(tickerRow: Record<string, unknown>, indicatorRow: Record<string, unknown>) {
  let callCount = 0;
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'tickers') {
      return {
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: tickerRow, error: null }),
          }),
        }),
      };
    }
    if (table === 'indicators') {
      return {
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: indicatorRow, error: null }),
          }),
        }),
      };
    }
    return {};
  });
  return { from } as unknown as TypedSupabaseClient;
}

describe('IndicatorHandle.resolve', () => {
  it('resolves ticker first, then upserts indicator with ticker_id', async () => {
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const indicatorRow = { id: 10, type: 'SMA', ticker_id: 1, lookback: 200, delay: 0, unit: null, threshold: null, created_at: '' };
    const sb = mockSupabaseChained(tickerRow, indicatorRow);
    const ticker = new TickerHandle(sb, 'SPY');
    const handle = new IndicatorHandle(sb, {
      type: 'SMA',
      ticker,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const result = await handle.resolve();

    expect(result).toEqual(indicatorRow);
    expect(handle.id).toBe(10);
    expect(sb.from).toHaveBeenCalledWith('tickers');
    expect(sb.from).toHaveBeenCalledWith('indicators');
  });

  it('resolves standalone indicator without ticker', async () => {
    const indicatorRow = { id: 20, type: 'VIX', ticker_id: null, lookback: 0, delay: 0, unit: null, threshold: null, created_at: '' };
    const single = vi.fn().mockResolvedValue({ data: indicatorRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });
    const sb = { from } as unknown as TypedSupabaseClient;

    const handle = new IndicatorHandle(sb, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    const result = await handle.resolve();
    expect(result).toEqual(indicatorRow);
    expect(handle.id).toBe(20);
  });

  it('caches resolution', async () => {
    const indicatorRow = { id: 20, type: 'VIX', ticker_id: null, lookback: 0, delay: 0, unit: null, threshold: null, created_at: '' };
    const single = vi.fn().mockResolvedValue({ data: indicatorRow, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const upsert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ upsert });
    const sb = { from } as unknown as TypedSupabaseClient;

    const handle = new IndicatorHandle(sb, {
      type: 'VIX',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });

    await handle.resolve();
    await handle.resolve();
    expect(from).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/handles/indicator.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: Commit**

```bash
git add src/handles/indicator.ts src/handles/indicator.test.ts
git commit -m "feat: add IndicatorHandle with lazy resolution, series, and value"
```

---

### Task 3: Handles Barrel Export

**Files:**
- Create: `src/handles/index.ts`

- [ ] **Step 1: Create the barrel export**

```ts
// src/handles/index.ts
export { TickerHandle } from './ticker.js';
export { IndicatorHandle } from './indicator.js';
export type { IndicatorIdentity, DateRange } from './indicator.js';
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/handles/index.ts
git commit -m "feat: add handles barrel export"
```

---

### Task 4: Client with Factory Methods

**Files:**
- Create: `src/client.ts`
- Modify: `src/types.ts`
- Modify: `src/index.ts`
- Modify: `package.json` (remove subpath exports)
- Test: `src/client.test.ts`

- [ ] **Step 1: Write the failing test for factory methods**

```ts
// src/client.test.ts
import { describe, it, expect } from 'vitest';
import { createClient } from './client.js';
import { TickerHandle } from './handles/ticker.js';
import { IndicatorHandle } from './handles/indicator.js';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { TypedSupabaseClient } from './types.js';

function testSupabase() {
  return createSupabaseClient('https://test.supabase.co', 'test-key') as unknown as TypedSupabaseClient;
}

describe('sdk.ticker', () => {
  it('returns a TickerHandle', () => {
    const sdk = createClient({ supabase: testSupabase() });
    const spy = sdk.ticker('SPY');
    expect(spy).toBeInstanceOf(TickerHandle);
    expect(spy.symbol).toBe('SPY');
    expect(spy.leverage).toBe(1);
  });

  it('accepts explicit leverage', () => {
    const sdk = createClient({ supabase: testSupabase() });
    const spxl = sdk.ticker('SPXL', 3);
    expect(spxl.leverage).toBe(3);
  });
});

describe('ticker-bound indicator factories', () => {
  const sdk = createClient({ supabase: testSupabase() });
  const spy = sdk.ticker('SPY');

  it('sdk.sma()', () => {
    const h = sdk.sma(spy, 200);
    expect(h).toBeInstanceOf(IndicatorHandle);
    expect(h.type).toBe('SMA');
    expect(h.lookback).toBe(200);
    expect(h.delay).toBe(0);
    expect(h.ticker).toBe(spy);
  });

  it('sdk.sma() with delay', () => {
    const h = sdk.sma(spy, 200, { delay: 1 });
    expect(h.delay).toBe(1);
  });

  it('sdk.ema()', () => {
    const h = sdk.ema(spy, 50);
    expect(h.type).toBe('EMA');
    expect(h.lookback).toBe(50);
  });

  it('sdk.price()', () => {
    const h = sdk.price(spy);
    expect(h.type).toBe('Price');
    expect(h.lookback).toBe(0);
  });

  it('sdk.returns()', () => {
    const h = sdk.returns(spy, 20);
    expect(h.type).toBe('Return');
    expect(h.lookback).toBe(20);
  });

  it('sdk.volatility()', () => {
    const h = sdk.volatility(spy, 30);
    expect(h.type).toBe('Volatility');
    expect(h.lookback).toBe(30);
  });

  it('sdk.drawdown()', () => {
    const h = sdk.drawdown(spy, 252);
    expect(h.type).toBe('Drawdown');
    expect(h.lookback).toBe(252);
  });

  it('sdk.rsi()', () => {
    const h = sdk.rsi(spy, 14);
    expect(h.type).toBe('RSI');
    expect(h.lookback).toBe(14);
  });
});

describe('standalone indicator factories', () => {
  const sdk = createClient({ supabase: testSupabase() });

  it('sdk.vix()', () => {
    const h = sdk.vix();
    expect(h.type).toBe('VIX');
    expect(h.ticker).toBeNull();
    expect(h.lookback).toBe(0);
  });

  it('sdk.vix3m()', () => {
    const h = sdk.vix3m();
    expect(h.type).toBe('VIX3M');
    expect(h.ticker).toBeNull();
  });

  it('sdk.treasury()', () => {
    const h = sdk.treasury('T10Y');
    expect(h.type).toBe('T10Y');
    expect(h.ticker).toBeNull();
  });

  it('sdk.calendar()', () => {
    const h = sdk.calendar('Month');
    expect(h.type).toBe('Month');
    expect(h.ticker).toBeNull();
  });
});

describe('threshold factory', () => {
  const sdk = createClient({ supabase: testSupabase() });

  it('sdk.threshold() without unit', () => {
    const h = sdk.threshold(0.5);
    expect(h.type).toBe('Threshold');
    expect(h.threshold).toBe(0.5);
    expect(h.unit).toBeNull();
    expect(h.ticker).toBeNull();
  });

  it('sdk.threshold() with unit', () => {
    const h = sdk.threshold(5, '%');
    expect(h.threshold).toBe(5);
    expect(h.unit).toBe('%');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/client.test.ts`
Expected: FAIL — cannot find `./client.js`

- [ ] **Step 3: Implement client.ts**

```ts
// src/client.ts
import type { Database } from './database.types.js';
import type { TypedSupabaseClient } from './types.js';
import { TickerHandle } from './handles/ticker.js';
import { IndicatorHandle } from './handles/indicator.js';
import type { DateRange } from './handles/indicator.js';

type IndicatorType = Database['public']['Enums']['indicator_type'];
type Unit = Database['public']['Enums']['unit'];

type TreasuryTenor = Extract<IndicatorType, 'T3M' | 'T6M' | 'T1Y' | 'T2Y' | 'T3Y' | 'T5Y' | 'T7Y' | 'T10Y' | 'T20Y' | 'T30Y'>;
type CalendarPeriod = Extract<IndicatorType, 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year'>;

interface IndicatorOpts {
  delay?: number;
}

export interface LivefolioClient {
  ticker(symbol: string, leverage?: number): TickerHandle;

  // Ticker-bound
  sma(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;
  ema(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;
  price(ticker: TickerHandle, opts?: IndicatorOpts): IndicatorHandle;
  returns(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;
  volatility(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;
  drawdown(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;
  rsi(ticker: TickerHandle, lookback: number, opts?: IndicatorOpts): IndicatorHandle;

  // Standalone
  vix(opts?: IndicatorOpts): IndicatorHandle;
  vix3m(opts?: IndicatorOpts): IndicatorHandle;
  treasury(tenor: TreasuryTenor, opts?: IndicatorOpts): IndicatorHandle;
  calendar(period: CalendarPeriod, opts?: IndicatorOpts): IndicatorHandle;

  // Threshold
  threshold(value: number, unit?: Unit): IndicatorHandle;
}

export interface LivefolioClientOptions {
  supabase: TypedSupabaseClient;
}

function tickerBound(
  sb: TypedSupabaseClient,
  type: IndicatorType,
  ticker: TickerHandle,
  lookback: number,
  opts?: IndicatorOpts,
): IndicatorHandle {
  return new IndicatorHandle(sb, {
    type,
    ticker,
    lookback,
    delay: opts?.delay ?? 0,
    unit: null,
    threshold: null,
  });
}

function standalone(
  sb: TypedSupabaseClient,
  type: IndicatorType,
  opts?: IndicatorOpts,
): IndicatorHandle {
  return new IndicatorHandle(sb, {
    type,
    ticker: null,
    lookback: 0,
    delay: opts?.delay ?? 0,
    unit: null,
    threshold: null,
  });
}

export function createClient(options: LivefolioClientOptions): LivefolioClient {
  const sb = options.supabase;

  return {
    ticker: (symbol, leverage) => new TickerHandle(sb, symbol, leverage),

    sma: (ticker, lookback, opts?) => tickerBound(sb, 'SMA', ticker, lookback, opts),
    ema: (ticker, lookback, opts?) => tickerBound(sb, 'EMA', ticker, lookback, opts),
    price: (ticker, opts?) => tickerBound(sb, 'Price', ticker, 0, opts),
    returns: (ticker, lookback, opts?) => tickerBound(sb, 'Return', ticker, lookback, opts),
    volatility: (ticker, lookback, opts?) => tickerBound(sb, 'Volatility', ticker, lookback, opts),
    drawdown: (ticker, lookback, opts?) => tickerBound(sb, 'Drawdown', ticker, lookback, opts),
    rsi: (ticker, lookback, opts?) => tickerBound(sb, 'RSI', ticker, lookback, opts),

    vix: (opts?) => standalone(sb, 'VIX', opts),
    vix3m: (opts?) => standalone(sb, 'VIX3M', opts),
    treasury: (tenor, opts?) => standalone(sb, tenor, opts),
    calendar: (period, opts?) => standalone(sb, period, opts),

    threshold: (value, unit?) =>
      new IndicatorHandle(sb, {
        type: 'Threshold',
        ticker: null,
        lookback: 0,
        delay: 0,
        unit: unit ?? null,
        threshold: value,
      }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/client.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/client.ts src/client.test.ts
git commit -m "feat: add createClient with ticker and indicator factory methods"
```

---

### Task 5: Update Root Exports and Clean Up

**Files:**
- Modify: `src/types.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Delete: `src/index.test.ts` (old tests for empty client)

- [ ] **Step 1: Update types.ts — remove old LivefolioClient interface**

Replace the full contents of `src/types.ts` with:

```ts
// src/types.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

export type { Database };

export type TypedSupabaseClient = SupabaseClient<Database>;
```

- [ ] **Step 2: Update index.ts — re-export from new modules**

Replace the full contents of `src/index.ts` with:

```ts
// src/index.ts
export { createClient } from './client.js';
export type { LivefolioClient, LivefolioClientOptions } from './client.js';
export type { TypedSupabaseClient, Database } from './types.js';
export { TickerHandle } from './handles/ticker.js';
export { IndicatorHandle } from './handles/indicator.js';
export type { IndicatorIdentity, DateRange } from './handles/indicator.js';
```

- [ ] **Step 3: Remove old subpath exports from package.json**

Remove the `./strategy` and `./evaluation` entries from the `"exports"` field, keeping only `"."`:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  }
},
```

- [ ] **Step 4: Delete old test file**

```bash
rm src/index.test.ts
```

- [ ] **Step 5: Run full type check and test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all type checks pass, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/index.ts package.json
git rm src/index.test.ts
git commit -m "refactor: wire up lazy handle exports, remove old module scaffolding"
```

---

### Task 6: Build Verification

**Files:** none (verification only)

- [ ] **Step 1: Clean build**

```bash
npm run clean && npm run build
```

Expected: `dist/` contains compiled JS + declarations for all new files

- [ ] **Step 2: Verify exports resolve**

```bash
node -e "import('@livefolio/sdk').then(m => console.log(Object.keys(m)))"
```

Expected: prints `['createClient', 'TickerHandle', 'IndicatorHandle']`

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 4: Commit any lint fixes if needed**

```bash
git add -A && git commit -m "chore: lint fixes"
```
