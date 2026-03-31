# StrategyHandle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement StrategyHandle — the top-level composition layer that maps signal conditions to allocations on a rebalancing schedule, with dense series storage.

**Architecture:** Pure evaluation functions in `computations/strategy.ts` handle rebalance date computation and rule evaluation. `handles/strategy.ts` manages resolve (create/reference modes), sync, DB persistence, and caching. Static `fromRow()` factories on existing handles enable reconstruction from stored definitions.

**Tech Stack:** TypeScript, Vitest, Supabase, nanoid

---

### Task 1: Install nanoid dependency

**Files:**
- Modify: `sdk/package.json`

- [ ] **Step 1: Install nanoid**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npm install nanoid
```

- [ ] **Step 2: Verify import works**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && node -e "import('nanoid').then(m => console.log(m.nanoid()))"
```

Expected: A random string like `V1StGXR8_Z5jdHi6B-myT`

- [ ] **Step 3: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2 && git add sdk/package.json sdk/package-lock.json && git commit -m "chore: add nanoid dependency for strategy link_id generation"
```

---

### Task 2: Pure evaluation functions (TDD)

**Files:**
- Create: `sdk/src/computations/strategy.ts`
- Create: `sdk/src/computations/strategy.test.ts`

- [ ] **Step 1: Write failing tests**

Create `sdk/src/computations/strategy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeRebalanceDates, evaluateStrategy } from './strategy.js';

describe('computeRebalanceDates', () => {
  it('Daily returns all trading days', () => {
    const days = ['2025-01-06', '2025-01-07', '2025-01-08'];
    expect(computeRebalanceDates(days, 'Daily', 0)).toEqual(new Set(days));
  });

  it('Weekly returns last trading day of each ISO week', () => {
    const days = [
      '2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10',
      '2025-01-13', '2025-01-14', '2025-01-15', '2025-01-16', '2025-01-17',
    ];
    expect(computeRebalanceDates(days, 'Weekly', 0)).toEqual(
      new Set(['2025-01-10', '2025-01-17']),
    );
  });

  it('Monthly returns last trading day of each month', () => {
    const days = [
      '2025-01-29', '2025-01-30', '2025-01-31',
      '2025-02-26', '2025-02-27', '2025-02-28',
    ];
    expect(computeRebalanceDates(days, 'Monthly', 0)).toEqual(
      new Set(['2025-01-31', '2025-02-28']),
    );
  });

  it('positive offset shifts earlier', () => {
    const days = [
      '2025-01-29', '2025-01-30', '2025-01-31',
      '2025-02-26', '2025-02-27', '2025-02-28',
    ];
    expect(computeRebalanceDates(days, 'Monthly', 1)).toEqual(
      new Set(['2025-01-30', '2025-02-27']),
    );
  });

  it('negative offset shifts later', () => {
    const days = [
      '2025-01-29', '2025-01-30', '2025-01-31',
      '2025-02-03', '2025-02-04',
      '2025-02-26', '2025-02-27', '2025-02-28',
    ];
    // Jan last = index 2 (01-31), offset -1 -> index 3 (02-03)
    // Feb last = index 7 (02-28), offset -1 -> index 8 -> out of bounds, skipped
    expect(computeRebalanceDates(days, 'Monthly', -1)).toEqual(new Set(['2025-02-03']));
  });

  it('Quarterly returns last trading day of each quarter', () => {
    const days = ['2025-03-28', '2025-03-31', '2025-06-27', '2025-06-30'];
    expect(computeRebalanceDates(days, 'Quarterly', 0)).toEqual(
      new Set(['2025-03-31', '2025-06-30']),
    );
  });

  it('Yearly returns last trading day of each year', () => {
    const days = ['2024-12-30', '2024-12-31', '2025-12-30', '2025-12-31'];
    expect(computeRebalanceDates(days, 'Yearly', 0)).toEqual(
      new Set(['2024-12-31', '2025-12-31']),
    );
  });
});

describe('evaluateStrategy', () => {
  it('evaluates rules on rebalance dates', () => {
    const signals = new Map([
      [1, new Map([['2025-01-06', true], ['2025-01-07', false], ['2025-01-08', true]])],
    ]);
    const rules = [
      { signalIds: [1], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const rebalance = new Set(['2025-01-06', '2025-01-07', '2025-01-08']);
    const days = ['2025-01-06', '2025-01-07', '2025-01-08'];

    const result = evaluateStrategy(signals, rules, rebalance, days);

    expect(result.get('2025-01-06')).toBe(0);
    expect(result.get('2025-01-07')).toBe(1);
    expect(result.get('2025-01-08')).toBe(0);
  });

  it('carries forward between rebalance dates', () => {
    const signals = new Map([[1, new Map([['2025-01-06', true]])]]);
    const rules = [
      { signalIds: [1], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const rebalance = new Set(['2025-01-06']);
    const days = ['2025-01-06', '2025-01-07', '2025-01-08'];

    const result = evaluateStrategy(signals, rules, rebalance, days);

    expect(result.get('2025-01-06')).toBe(0);
    expect(result.get('2025-01-07')).toBe(0);
    expect(result.get('2025-01-08')).toBe(0);
  });

  it('skips trading days before first rebalance', () => {
    const signals = new Map([[1, new Map([['2025-01-08', true]])]]);
    const rules = [
      { signalIds: [1], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const rebalance = new Set(['2025-01-08']);
    const days = ['2025-01-06', '2025-01-07', '2025-01-08'];

    const result = evaluateStrategy(signals, rules, rebalance, days);

    expect(result.has('2025-01-06')).toBe(false);
    expect(result.has('2025-01-07')).toBe(false);
    expect(result.get('2025-01-08')).toBe(0);
  });

  it('ANDs multiple signals in a rule', () => {
    const signals = new Map([
      [1, new Map([['2025-01-06', true]])],
      [2, new Map([['2025-01-06', false]])],
    ]);
    const rules = [
      { signalIds: [1, 2], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const result = evaluateStrategy(signals, rules, new Set(['2025-01-06']), ['2025-01-06']);

    expect(result.get('2025-01-06')).toBe(1);
  });

  it('OR via duplicate rules pointing to same allocation', () => {
    const signals = new Map([
      [1, new Map([['2025-01-06', false], ['2025-01-07', true]])],
      [2, new Map([['2025-01-06', true], ['2025-01-07', false]])],
    ]);
    const rules = [
      { signalIds: [1], allocationIndex: 0 },
      { signalIds: [2], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const days = ['2025-01-06', '2025-01-07'];
    const result = evaluateStrategy(signals, rules, new Set(days), days);

    expect(result.get('2025-01-06')).toBe(0);
    expect(result.get('2025-01-07')).toBe(0);
  });

  it('treats missing signal data as false', () => {
    const signals = new Map([[1, new Map<string, boolean>()]]);
    const rules = [
      { signalIds: [1], allocationIndex: 0 },
      { signalIds: [], allocationIndex: 1 },
    ];
    const result = evaluateStrategy(signals, rules, new Set(['2025-01-06']), ['2025-01-06']);

    expect(result.get('2025-01-06')).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/computations/strategy.test.ts
```

Expected: FAIL — module `./strategy.js` not found

- [ ] **Step 3: Implement both functions**

Create `sdk/src/computations/strategy.ts`:

```typescript
import type { Database } from '../database.types.js';

type TradingFreq = Database['public']['Enums']['trading_freq'];

function getPeriodKey(dateStr: string, freq: TradingFreq): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();

  switch (freq) {
    case 'Weekly': {
      const thu = new Date(d);
      thu.setUTCDate(thu.getUTCDate() + 3 - ((thu.getUTCDay() + 6) % 7));
      const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${thu.getUTCFullYear()}-W${weekNo}`;
    }
    case 'Monthly':
      return `${y}-${m}`;
    case 'Bi-monthly':
      return `${y}-${Math.floor(m / 2)}`;
    case 'Quarterly':
      return `${y}-Q${Math.floor(m / 3)}`;
    case 'Every 4 Months':
      return `${y}-${Math.floor(m / 4)}`;
    case 'Semiannually':
      return `${y}-H${Math.floor(m / 6)}`;
    case 'Yearly':
      return `${y}`;
    default:
      return `${y}-${m}`;
  }
}

export function computeRebalanceDates(
  tradingDays: string[],
  freq: TradingFreq,
  offset: number,
): Set<string> {
  if (freq === 'Daily') return new Set(tradingDays);

  const groups = new Map<string, number[]>();
  for (let i = 0; i < tradingDays.length; i++) {
    const key = getPeriodKey(tradingDays[i], freq);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  const result = new Set<string>();
  for (const indices of groups.values()) {
    const lastIdx = indices[indices.length - 1];
    const targetIdx = lastIdx - offset;
    if (targetIdx >= 0 && targetIdx < tradingDays.length) {
      result.add(tradingDays[targetIdx]);
    }
  }

  return result;
}

export interface StrategyRuleInput {
  signalIds: number[];
  allocationIndex: number;
}

export function evaluateStrategy(
  signalSeries: Map<number, Map<string, boolean>>,
  rules: StrategyRuleInput[],
  rebalanceDates: Set<string>,
  tradingDays: string[],
): Map<string, number> {
  const result = new Map<string, number>();
  let current: number | undefined;

  for (const date of tradingDays) {
    if (rebalanceDates.has(date)) {
      for (const rule of rules) {
        if (rule.signalIds.length === 0) {
          current = rule.allocationIndex;
          break;
        }
        const allTrue = rule.signalIds.every((id) => signalSeries.get(id)?.get(date) ?? false);
        if (allTrue) {
          current = rule.allocationIndex;
          break;
        }
      }
    }
    if (current !== undefined) {
      result.set(date, current);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/computations/strategy.test.ts
```

Expected: PASS — all 13 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2 && git add sdk/src/computations/strategy.ts sdk/src/computations/strategy.test.ts && git commit -m "feat: add pure strategy evaluation functions"
```

---

### Task 3: Handle fromRow static factories (TDD)

**Files:**
- Modify: `sdk/src/handles/ticker.ts`
- Modify: `sdk/src/handles/indicator.ts`
- Modify: `sdk/src/handles/signal.ts`
- Modify: `sdk/src/handles/allocation.ts`
- Create: `sdk/src/handles/fromRow.test.ts`

- [ ] **Step 1: Write failing tests**

Create `sdk/src/handles/fromRow.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TickerHandle } from './ticker.js';
import { IndicatorHandle } from './indicator.js';
import { SignalHandle } from './signal.js';
import { AllocationHandle } from './allocation.js';
import type { TypedSupabaseClient } from '../types.js';

const sb = {} as TypedSupabaseClient;

describe('TickerHandle.fromRow', () => {
  it('creates a pre-resolved handle', () => {
    const row = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const handle = TickerHandle.fromRow(sb, row);
    expect(handle.symbol).toBe('SPY');
    expect(handle.leverage).toBe(1);
    expect(handle.id).toBe(1);
  });

  it('resolve() returns cached row without DB call', async () => {
    const row = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const handle = TickerHandle.fromRow(sb, row);
    const result = await handle.resolve();
    expect(result).toEqual(row);
  });
});

describe('IndicatorHandle.fromRow', () => {
  it('creates a pre-resolved handle with ticker', () => {
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const ticker = TickerHandle.fromRow(sb, tickerRow);
    const row = {
      id: 10, type: 'SMA' as const, ticker_id: 1, lookback: 200,
      delay: 0, unit: null, threshold: null, created_at: '',
    };
    const handle = IndicatorHandle.fromRow(sb, row, ticker);
    expect(handle.type).toBe('SMA');
    expect(handle.ticker).toBe(ticker);
    expect(handle.lookback).toBe(200);
    expect(handle.id).toBe(10);
  });

  it('creates a pre-resolved handle without ticker', () => {
    const row = {
      id: 20, type: 'VIX' as const, ticker_id: null, lookback: 0,
      delay: 0, unit: null, threshold: null, created_at: '',
    };
    const handle = IndicatorHandle.fromRow(sb, row, null);
    expect(handle.type).toBe('VIX');
    expect(handle.ticker).toBeNull();
    expect(handle.id).toBe(20);
  });
});

describe('SignalHandle.fromRow', () => {
  it('creates a pre-resolved handle', () => {
    const ind1 = new IndicatorHandle(sb, {
      type: 'Price', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null,
    });
    const ind2 = new IndicatorHandle(sb, {
      type: 'SMA', ticker: null, lookback: 200, delay: 0, unit: null, threshold: null,
    });
    const row = {
      id: 100, indicator_id_1: 10, indicator_id_2: 11,
      comparison: '>' as const, tolerance: 5, created_at: '',
    };
    const handle = SignalHandle.fromRow(sb, row, ind1, ind2);
    expect(handle.comparison).toBe('>');
    expect(handle.tolerance).toBe(5);
    expect(handle.indicator1).toBe(ind1);
    expect(handle.indicator2).toBe(ind2);
    expect(handle.id).toBe(100);
  });
});

describe('AllocationHandle.fromRow', () => {
  it('creates a pre-resolved handle from JSONB holdings', () => {
    const row = { id: 50, holdings: { SPY: 0.6, GLD: 0.4 }, created_at: '' };
    const handle = AllocationHandle.fromRow(sb, row);
    expect(handle.id).toBe(50);
    expect(handle.holdings).toHaveLength(2);
  });

  it('parses leverage from key format', () => {
    const row = { id: 51, holdings: { 'SPXL?L=3': 1.0 }, created_at: '' };
    const handle = AllocationHandle.fromRow(sb, row);
    expect(handle.holdings[0][0].symbol).toBe('SPXL');
    expect(handle.holdings[0][0].leverage).toBe(3);
  });

  it('resolve() returns cached row', async () => {
    const row = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };
    const handle = AllocationHandle.fromRow(sb, row);
    const result = await handle.resolve();
    expect(result).toEqual(row);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/fromRow.test.ts
```

Expected: FAIL — `TickerHandle.fromRow is not a function`

- [ ] **Step 3: Add fromRow to TickerHandle**

In `sdk/src/handles/ticker.ts`, add this static method inside the `TickerHandle` class, after the `_doResolve` method:

```typescript
static fromRow(supabase: TypedSupabaseClient, row: TickerRow): TickerHandle {
  const handle = new TickerHandle(supabase, row.symbol, row.leverage);
  handle._resolved = row;
  return handle;
}
```

- [ ] **Step 4: Add fromRow to IndicatorHandle**

In `sdk/src/handles/indicator.ts`, add this static method inside the `IndicatorHandle` class:

```typescript
static fromRow(
  supabase: TypedSupabaseClient,
  row: IndicatorRow,
  ticker: TickerHandle | null,
  config?: IndicatorConfig,
): IndicatorHandle {
  const handle = new IndicatorHandle(
    supabase,
    { type: row.type, ticker, lookback: row.lookback, delay: row.delay, unit: row.unit, threshold: row.threshold },
    config,
  );
  handle._resolved = row;
  return handle;
}
```

- [ ] **Step 5: Add fromRow to SignalHandle**

In `sdk/src/handles/signal.ts`, add this static method inside the `SignalHandle` class:

```typescript
static fromRow(
  supabase: TypedSupabaseClient,
  row: SignalRow,
  indicator1: IndicatorHandle,
  indicator2: IndicatorHandle,
  config?: IndicatorConfig,
): SignalHandle {
  const handle = new SignalHandle(
    supabase,
    { indicator1, indicator2, comparison: row.comparison, tolerance: row.tolerance },
    config,
  );
  handle._resolved = row;
  return handle;
}
```

- [ ] **Step 6: Add fromRow to AllocationHandle**

In `sdk/src/handles/allocation.ts`:

1. Change the import from type-only to value import:

```typescript
// Change:
import type { TickerHandle } from './ticker.js';
// To:
import { TickerHandle } from './ticker.js';
```

2. Add this static method inside the `AllocationHandle` class:

```typescript
static fromRow(supabase: TypedSupabaseClient, row: AllocationRow): AllocationHandle {
  const holdingsJson = row.holdings as Record<string, number>;
  const holdings: [TickerHandle, number][] = [];
  for (const [key, weight] of Object.entries(holdingsJson)) {
    const match = key.match(/^(.+)\?L=(.+)$/);
    const symbol = match ? match[1] : key;
    const leverage = match ? Number(match[2]) : 1;
    holdings.push([new TickerHandle(supabase, symbol, leverage), weight]);
  }
  const handle = new AllocationHandle(supabase, holdings);
  handle._resolved = row;
  return handle;
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/fromRow.test.ts
```

Expected: PASS — all 7 tests

- [ ] **Step 8: Run full test suite to check no regressions**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run
```

Expected: All existing tests still pass

- [ ] **Step 9: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2 && git add sdk/src/handles/ticker.ts sdk/src/handles/indicator.ts sdk/src/handles/signal.ts sdk/src/handles/allocation.ts sdk/src/handles/fromRow.test.ts && git commit -m "feat: add fromRow() static factories to all handle classes"
```

---

### Task 4: StrategyHandle construction and validation (TDD)

**Files:**
- Create: `sdk/src/handles/strategy.ts`
- Create: `sdk/src/handles/strategy.test.ts`

- [ ] **Step 1: Write failing tests**

Create `sdk/src/handles/strategy.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { StrategyHandle } from './strategy.js';
import { SignalHandle } from './signal.js';
import { AllocationHandle } from './allocation.js';
import { IndicatorHandle } from './indicator.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

const sb = {} as TypedSupabaseClient;

function makeSignal() {
  const ind1 = new IndicatorHandle(sb, {
    type: 'VIX', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null,
  });
  const ind2 = new IndicatorHandle(sb, {
    type: 'Threshold', ticker: null, lookback: 0, delay: 0, unit: null, threshold: 30,
  });
  return new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 0 });
}

function makeAllocation() {
  return new AllocationHandle(sb, [[new TickerHandle(sb, 'SPY'), 1.0]]);
}

describe('StrategyHandle construction - create mode', () => {
  it('stores options with defaults', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(sb, { name: 'Test', rules: [{ hold: alloc }] });
    expect(handle.name).toBe('Test');
    expect(handle.freq).toBe('Daily');
    expect(handle.offset).toBe(0);
    expect(handle.rules).toHaveLength(1);
  });

  it('stores explicit freq and offset', () => {
    const signal = makeSignal();
    const alloc1 = makeAllocation();
    const alloc2 = makeAllocation();
    const handle = new StrategyHandle(sb, {
      name: 'Tactical',
      freq: 'Monthly',
      offset: 2,
      rules: [{ when: [signal], hold: alloc1 }, { hold: alloc2 }],
    });
    expect(handle.freq).toBe('Monthly');
    expect(handle.offset).toBe(2);
    expect(handle.rules).toHaveLength(2);
  });

  it('throws if rules array is empty', () => {
    expect(() => new StrategyHandle(sb, { name: 'Empty', rules: [] })).toThrow('at least one rule');
  });

  it('throws if last rule has a when clause', () => {
    const signal = makeSignal();
    const alloc = makeAllocation();
    expect(
      () => new StrategyHandle(sb, { name: 'Bad', rules: [{ when: [signal], hold: alloc }] }),
    ).toThrow('fallback');
  });

  it('throws on .id before resolution', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(sb, { name: 'Test', rules: [{ hold: alloc }] });
    expect(() => handle.id).toThrow('not yet resolved');
  });

  it('throws on .link before resolution', () => {
    const alloc = makeAllocation();
    const handle = new StrategyHandle(sb, { name: 'Test', rules: [{ hold: alloc }] });
    expect(() => handle.link).toThrow('not yet resolved');
  });
});

describe('StrategyHandle construction - reference mode', () => {
  it('stores linkId with defaults', () => {
    const handle = new StrategyHandle(sb, 'abc123');
    expect(handle.name).toBeNull();
    expect(handle.freq).toBe('Daily');
    expect(handle.offset).toBe(0);
    expect(handle.rules).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/strategy.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement StrategyHandle skeleton**

Create `sdk/src/handles/strategy.ts`:

```typescript
import { nanoid } from 'nanoid';
import type { TypedSupabaseClient } from '../types.js';
import type { Tables, Database } from '../database.types.js';
import { SignalHandle } from './signal.js';
import { AllocationHandle } from './allocation.js';
import { TickerHandle } from './ticker.js';
import { IndicatorHandle } from './indicator.js';
import type { DateRange, DailyBar, IndicatorConfig } from './indicator.js';
import { evaluateStrategy, computeRebalanceDates } from '../computations/strategy.js';

type StrategyRow = Tables<'strategies'>;
type TradingFreq = Database['public']['Enums']['trading_freq'];

export interface StrategyRule {
  when?: SignalHandle[];
  hold: AllocationHandle;
}

export interface StrategyBar {
  date: string;
  allocation: AllocationHandle;
}

export interface StrategyOptions {
  name: string;
  freq?: TradingFreq;
  offset?: number;
  rules: StrategyRule[];
}

export class StrategyHandle {
  private _linkId: string | null;
  private _name: string | null;
  private _freq: TradingFreq;
  private _offset: number;
  private _rules: StrategyRule[];

  private _supabase: TypedSupabaseClient;
  private _config: IndicatorConfig;
  private _resolved: StrategyRow | null = null;
  private _resolving: Promise<StrategyRow> | null = null;
  private _allocationMap: Map<number, AllocationHandle> = new Map();

  private _cache: StrategyBar[] | null = null;
  private _cachedAsOf: string | null = null;
  private _syncing: Promise<void> | null = null;

  constructor(
    supabase: TypedSupabaseClient,
    optionsOrLinkId: StrategyOptions | string,
    config?: IndicatorConfig,
  ) {
    this._supabase = supabase;
    this._config = config ?? {};

    if (typeof optionsOrLinkId === 'string') {
      this._linkId = optionsOrLinkId;
      this._name = null;
      this._freq = 'Daily';
      this._offset = 0;
      this._rules = [];
    } else {
      const opts = optionsOrLinkId;
      if (opts.rules.length === 0) {
        throw new Error('Strategy must have at least one rule');
      }
      const lastRule = opts.rules[opts.rules.length - 1];
      if (lastRule.when && lastRule.when.length > 0) {
        throw new Error('Last rule must be a fallback (no when clause)');
      }
      this._linkId = null;
      this._name = opts.name;
      this._freq = opts.freq ?? 'Daily';
      this._offset = opts.offset ?? 0;
      this._rules = opts.rules;
    }
  }

  get id(): number {
    if (!this._resolved) throw new Error('StrategyHandle not yet resolved. Call resolve() first.');
    return this._resolved.id;
  }

  get link(): string {
    if (!this._resolved) throw new Error('StrategyHandle not yet resolved. Call resolve() first.');
    return this._resolved.link_id;
  }

  get name(): string | null {
    return this._name;
  }

  get freq(): TradingFreq {
    return this._freq;
  }

  get offset(): number {
    return this._offset;
  }

  get rules(): StrategyRule[] {
    return this._rules;
  }

  async resolve(): Promise<StrategyRow> {
    if (this._resolved) return this._resolved;
    if (!this._resolving) {
      this._resolving =
        this._linkId !== null && this._name === null
          ? this._doResolveReference()
          : this._doResolveCreate();
    }
    return this._resolving;
  }

  private async _doResolveCreate(): Promise<StrategyRow> {
    throw new Error('Not implemented');
  }

  private async _doResolveReference(): Promise<StrategyRow> {
    throw new Error('Not implemented');
  }

  async series(_range?: DateRange): Promise<StrategyBar[]> {
    throw new Error('Not implemented');
  }

  async value(_date?: string): Promise<AllocationHandle | null> {
    throw new Error('Not implemented');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/strategy.test.ts
```

Expected: PASS — all 7 construction tests

- [ ] **Step 5: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2 && git add sdk/src/handles/strategy.ts sdk/src/handles/strategy.test.ts && git commit -m "feat: add StrategyHandle with construction and validation"
```

---

### Task 5: StrategyHandle create mode resolve (TDD)

**Files:**
- Modify: `sdk/src/handles/strategy.ts`
- Modify: `sdk/src/handles/strategy.test.ts`

- [ ] **Step 1: Write failing test for create mode resolve**

Add to `sdk/src/handles/strategy.test.ts`, after the existing imports add `vi`:

```typescript
import { describe, it, expect, vi } from 'vitest';
```

Then add this describe block:

```typescript
describe('StrategyHandle.resolve - create mode', () => {
  it('resolves dependencies, generates link_id, and inserts strategy', async () => {
    const indicatorRow = {
      id: 10, type: 'VIX', ticker_id: null, lookback: 0,
      delay: 0, unit: null, threshold: null, created_at: '',
    };
    const thresholdRow = {
      id: 11, type: 'Threshold', ticker_id: null, lookback: 0,
      delay: 0, unit: null, threshold: 30, created_at: '',
    };
    const signalRow = {
      id: 100, indicator_id_1: 10, indicator_id_2: 11,
      comparison: '>', tolerance: 0, created_at: '',
    };
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const allocRow = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };
    const strategyRow = {
      id: 200, link_id: 'generated-id', name: 'Test', trading_freq: 'Daily',
      trading_offset: 0, definition: {}, created_at: '',
    };

    let indCallCount = 0;
    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: strategyRow, error: null }),
      }),
    });

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'indicators') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(() => {
                indCallCount++;
                return Promise.resolve({
                  data: indCallCount <= 1 ? indicatorRow : thresholdRow,
                  error: null,
                });
              }),
            }),
          }),
        };
      }
      if (table === 'signals') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: signalRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'tickers') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: tickerRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'allocations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: allocRow, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'strategies') {
        return { insert: insertMock };
      }
      return {};
    });
    const mockSb = { from } as unknown as TypedSupabaseClient;

    const signal = new SignalHandle(mockSb, {
      indicator1: new IndicatorHandle(mockSb, {
        type: 'VIX', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null,
      }),
      indicator2: new IndicatorHandle(mockSb, {
        type: 'Threshold', ticker: null, lookback: 0, delay: 0, unit: null, threshold: 30,
      }),
      comparison: '>',
      tolerance: 0,
    });
    const alloc1 = new AllocationHandle(mockSb, [[new TickerHandle(mockSb, 'SPY'), 1.0]]);
    const alloc2 = new AllocationHandle(mockSb, [[new TickerHandle(mockSb, 'SPY'), 1.0]]);

    const handle = new StrategyHandle(mockSb, {
      name: 'Test',
      rules: [{ when: [signal], hold: alloc1 }, { hold: alloc2 }],
    });

    const result = await handle.resolve();

    expect(result.id).toBe(200);
    expect(handle.id).toBe(200);
    expect(handle.link).toBeDefined();
    expect(insertMock).toHaveBeenCalled();
    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg.name).toBe('Test');
    expect(insertArg.link_id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(insertArg.definition.rules).toHaveLength(2);
    expect(insertArg.definition.rules[0].signalIds).toEqual([100]);
    expect(insertArg.definition.rules[0].allocationId).toBe(50);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const strategyRow = {
      id: 200, link_id: 'x', name: 'Test', trading_freq: 'Daily',
      trading_offset: 0, definition: {}, created_at: '',
    };
    const allocRow = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };

    const insertMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: strategyRow, error: null }),
      }),
    });
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'tickers') {
        return { upsert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: tickerRow, error: null }) }) }) };
      }
      if (table === 'allocations') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: allocRow, error: null }) }) }) }) };
      }
      if (table === 'strategies') {
        return { insert: insertMock };
      }
      return {};
    });
    const mockSb = { from } as unknown as TypedSupabaseClient;

    const alloc = new AllocationHandle(mockSb, [[new TickerHandle(mockSb, 'SPY'), 1.0]]);
    const handle = new StrategyHandle(mockSb, { name: 'Test', rules: [{ hold: alloc }] });

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);
    expect(r1).toEqual(r2);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/strategy.test.ts
```

Expected: FAIL — `Not implemented`

- [ ] **Step 3: Implement _doResolveCreate**

In `sdk/src/handles/strategy.ts`, replace the `_doResolveCreate` stub:

```typescript
private async _doResolveCreate(): Promise<StrategyRow> {
  const allSignals = new Set<SignalHandle>();
  const allAllocations = new Set<AllocationHandle>();
  for (const rule of this._rules) {
    if (rule.when) rule.when.forEach((s) => allSignals.add(s));
    allAllocations.add(rule.hold);
  }

  await Promise.all([
    ...Array.from(allSignals).map((s) => s.resolve()),
    ...Array.from(allAllocations).map((a) => a.resolve()),
  ]);

  const definition = {
    rules: this._rules.map((rule) => ({
      signalIds: (rule.when ?? []).map((s) => s.id),
      allocationId: rule.hold.id,
    })),
  };

  const linkId = nanoid();

  const { data, error } = await this._supabase
    .from('strategies')
    .insert({
      link_id: linkId,
      name: this._name!,
      trading_freq: this._freq,
      trading_offset: this._offset,
      definition,
    })
    .select()
    .single();

  if (error) throw error;
  this._resolved = data;

  for (const rule of this._rules) {
    this._allocationMap.set(rule.hold.id, rule.hold);
  }

  return data;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/strategy.test.ts
```

Expected: PASS — all 9 tests (7 construction + 2 create resolve)

- [ ] **Step 5: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2 && git add sdk/src/handles/strategy.ts sdk/src/handles/strategy.test.ts && git commit -m "feat: implement StrategyHandle create mode resolve"
```

---

### Task 6: StrategyHandle reference mode resolve (TDD)

**Files:**
- Modify: `sdk/src/handles/strategy.ts`
- Modify: `sdk/src/handles/strategy.test.ts`

- [ ] **Step 1: Write failing test for reference mode resolve**

Add to `sdk/src/handles/strategy.test.ts`:

```typescript
describe('StrategyHandle.resolve - reference mode', () => {
  it('fetches strategy by link_id and reconstructs rules', async () => {
    const strategyRow = {
      id: 200, link_id: 'abc123', name: 'Tactical', trading_freq: 'Monthly',
      trading_offset: 2,
      definition: {
        rules: [
          { signalIds: [100], allocationId: 50 },
          { signalIds: [], allocationId: 51 },
        ],
      },
      created_at: '',
    };
    const signalRow = {
      id: 100, indicator_id_1: 10, indicator_id_2: 11,
      comparison: '>', tolerance: 5, created_at: '',
    };
    const indicatorRow1 = {
      id: 10, type: 'Price', ticker_id: 1, lookback: 0,
      delay: 0, unit: null, threshold: null, created_at: '',
    };
    const indicatorRow2 = {
      id: 11, type: 'SMA', ticker_id: 1, lookback: 200,
      delay: 0, unit: null, threshold: null, created_at: '',
    };
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const allocRow1 = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };
    const allocRow2 = { id: 51, holdings: { SHY: 1.0 }, created_at: '' };

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'strategies') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: strategyRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'signals') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [signalRow], error: null }),
          }),
        };
      }
      if (table === 'indicators') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [indicatorRow1, indicatorRow2], error: null }),
          }),
        };
      }
      if (table === 'tickers') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [tickerRow], error: null }),
          }),
        };
      }
      if (table === 'allocations') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [allocRow1, allocRow2], error: null }),
          }),
        };
      }
      return {};
    });
    const mockSb = { from } as unknown as TypedSupabaseClient;

    const handle = new StrategyHandle(mockSb, 'abc123');
    const result = await handle.resolve();

    expect(result.id).toBe(200);
    expect(handle.id).toBe(200);
    expect(handle.link).toBe('abc123');
    expect(handle.name).toBe('Tactical');
    expect(handle.freq).toBe('Monthly');
    expect(handle.offset).toBe(2);
    expect(handle.rules).toHaveLength(2);
    expect(handle.rules[0].when).toHaveLength(1);
    expect(handle.rules[0].when![0].comparison).toBe('>');
    expect(handle.rules[0].hold.id).toBe(50);
    expect(handle.rules[1].when).toBeUndefined();
    expect(handle.rules[1].hold.id).toBe(51);
  });

  it('throws on invalid link_id', async () => {
    const from = vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116', message: 'not found' },
          }),
        }),
      }),
    }));
    const mockSb = { from } as unknown as TypedSupabaseClient;

    const handle = new StrategyHandle(mockSb, 'invalid');
    await expect(handle.resolve()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/strategy.test.ts
```

Expected: FAIL — `Not implemented`

- [ ] **Step 3: Implement _doResolveReference**

In `sdk/src/handles/strategy.ts`, replace the `_doResolveReference` stub:

```typescript
private async _doResolveReference(): Promise<StrategyRow> {
  const { data: stratRow, error } = await this._supabase
    .from('strategies')
    .select()
    .eq('link_id', this._linkId!)
    .single();

  if (error) throw error;

  this._name = stratRow.name;
  this._freq = stratRow.trading_freq;
  this._offset = stratRow.trading_offset;

  const def = stratRow.definition as {
    rules: { signalIds: number[]; allocationId: number }[];
  };

  // Collect all IDs needed
  const signalIds = new Set<number>();
  const allocationIds = new Set<number>();
  for (const rule of def.rules) {
    rule.signalIds.forEach((id) => signalIds.add(id));
    allocationIds.add(rule.allocationId);
  }

  // Batch fetch signals and allocations
  const [signalRows, allocationRows] = await Promise.all([
    signalIds.size > 0
      ? this._supabase
          .from('signals')
          .select()
          .in('id', Array.from(signalIds))
          .then((r) => {
            if (r.error) throw r.error;
            return r.data;
          })
      : Promise.resolve([]),
    this._supabase
      .from('allocations')
      .select()
      .in('id', Array.from(allocationIds))
      .then((r) => {
        if (r.error) throw r.error;
        return r.data;
      }),
  ]);

  // Fetch indicators needed by signals
  const indicatorIds = new Set<number>();
  for (const sr of signalRows) {
    indicatorIds.add(sr.indicator_id_1);
    indicatorIds.add(sr.indicator_id_2);
  }

  const indicatorRows =
    indicatorIds.size > 0
      ? await this._supabase
          .from('indicators')
          .select()
          .in('id', Array.from(indicatorIds))
          .then((r) => {
            if (r.error) throw r.error;
            return r.data;
          })
      : [];

  // Fetch tickers needed by indicators
  const tickerIds = new Set<number>();
  for (const ir of indicatorRows) {
    if (ir.ticker_id) tickerIds.add(ir.ticker_id);
  }

  const tickerRows =
    tickerIds.size > 0
      ? await this._supabase
          .from('tickers')
          .select()
          .in('id', Array.from(tickerIds))
          .then((r) => {
            if (r.error) throw r.error;
            return r.data;
          })
      : [];

  // Build handle maps bottom-up
  const tickerMap = new Map<number, TickerHandle>();
  for (const tr of tickerRows) {
    tickerMap.set(tr.id, TickerHandle.fromRow(this._supabase, tr));
  }

  const indicatorMap = new Map<number, IndicatorHandle>();
  for (const ir of indicatorRows) {
    const ticker = ir.ticker_id ? tickerMap.get(ir.ticker_id) ?? null : null;
    indicatorMap.set(ir.id, IndicatorHandle.fromRow(this._supabase, ir, ticker, this._config));
  }

  const signalMap = new Map<number, SignalHandle>();
  for (const sr of signalRows) {
    signalMap.set(
      sr.id,
      SignalHandle.fromRow(
        this._supabase,
        sr,
        indicatorMap.get(sr.indicator_id_1)!,
        indicatorMap.get(sr.indicator_id_2)!,
        this._config,
      ),
    );
  }

  const allocationMap = new Map<number, AllocationHandle>();
  for (const ar of allocationRows) {
    const handle = AllocationHandle.fromRow(this._supabase, ar);
    allocationMap.set(ar.id, handle);
    this._allocationMap.set(ar.id, handle);
  }

  // Reconstruct rules
  this._rules = def.rules.map((rule) => ({
    when: rule.signalIds.length > 0 ? rule.signalIds.map((id) => signalMap.get(id)!) : undefined,
    hold: allocationMap.get(rule.allocationId)!,
  }));

  this._resolved = stratRow;
  return stratRow;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/strategy.test.ts
```

Expected: PASS — all 11 tests

- [ ] **Step 5: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2 && git add sdk/src/handles/strategy.ts sdk/src/handles/strategy.test.ts && git commit -m "feat: implement StrategyHandle reference mode resolve"
```

---

### Task 7: StrategyHandle series and value (TDD)

**Files:**
- Modify: `sdk/src/handles/strategy.ts`
- Modify: `sdk/src/handles/strategy.test.ts`

- [ ] **Step 1: Write failing test for series**

Add to `sdk/src/handles/strategy.test.ts`:

```typescript
describe('StrategyHandle.series', () => {
  it('syncs signals, evaluates rules, and returns dense StrategyBar[]', async () => {
    // Pre-resolved handles for a simple strategy
    const allocRow1 = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };
    const allocRow2 = { id: 51, holdings: { SHY: 1.0 }, created_at: '' };
    const signalRow = {
      id: 100, indicator_id_1: 10, indicator_id_2: 11,
      comparison: '>', tolerance: 0, created_at: '',
    };
    const strategyRow = {
      id: 200, link_id: 'test', name: 'Test', trading_freq: 'Daily',
      trading_offset: 0, definition: {}, created_at: '',
    };

    // Signal series: true on day 1, false on day 2
    const signalBars: DailyBar[] = [
      { date: '2025-01-06', value: 1 },
      { date: '2025-01-07', value: 0 },
    ];

    // Trading days with close timestamps
    const tradingDayRows = [
      { id: 1001, date: '2025-01-06', close: '2025-01-06T21:00:00Z' },
      { id: 1002, date: '2025-01-07', close: '2025-01-07T21:00:00Z' },
    ];

    // strategies_series: empty (needs sync)
    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'strategies') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: strategyRow, error: null }),
            }),
          }),
        };
      }
      if (table === 'trading_days') {
        return {
          select: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
              order: vi.fn().mockImplementation((_col: string, opts?: { ascending: boolean }) => {
                if (opts?.ascending === false) {
                  // _getLatestClosedTradingDay: return most recent
                  return {
                    limit: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: { date: '2025-01-07' },
                        error: null,
                      }),
                    }),
                  };
                }
                // _sync: return all trading days ascending
                return vi.fn().mockResolvedValue({ data: tradingDayRows, error: null });
              }),
            }),
          }),
        };
      }
      if (table === 'strategies_series') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((_col: string, _val: unknown) => ({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { code: 'PGRST116' },
                  }),
                }),
                // For _querySeriesFromDb
                then: vi.fn().mockResolvedValue({
                  data: [
                    { allocation_id: 50, trading_days: { date: '2025-01-06' } },
                    { allocation_id: 51, trading_days: { date: '2025-01-07' } },
                  ],
                  error: null,
                }),
              }),
            })),
          }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });
    const mockSb = { from } as unknown as TypedSupabaseClient;

    // Build pre-resolved signal that returns known series
    const ind1 = IndicatorHandle.fromRow(mockSb, {
      id: 10, type: 'VIX' as const, ticker_id: null, lookback: 0,
      delay: 0, unit: null, threshold: null, created_at: '',
    }, null);
    const ind2 = IndicatorHandle.fromRow(mockSb, {
      id: 11, type: 'Threshold' as const, ticker_id: null, lookback: 0,
      delay: 0, unit: null, threshold: 30, created_at: '',
    }, null);
    const signal = SignalHandle.fromRow(mockSb, signalRow, ind1, ind2);

    // Mock signal.series() to return our test data
    vi.spyOn(signal, 'series').mockResolvedValue(signalBars);

    const alloc1 = AllocationHandle.fromRow(mockSb, allocRow1);
    const alloc2 = AllocationHandle.fromRow(mockSb, allocRow2);

    const handle = new StrategyHandle(mockSb, {
      name: 'Test',
      rules: [{ when: [signal], hold: alloc1 }, { hold: alloc2 }],
    });

    // Manually set resolved state to skip create mode DB insert
    (handle as any)._resolved = strategyRow;
    (handle as any)._allocationMap.set(50, alloc1);
    (handle as any)._allocationMap.set(51, alloc2);

    const bars = await handle.series();

    expect(bars).toHaveLength(2);
    expect(bars[0].date).toBe('2025-01-06');
    expect(bars[0].allocation).toBe(alloc1);
    expect(bars[1].date).toBe('2025-01-07');
    expect(bars[1].allocation).toBe(alloc2);
  });
});
```

Also add the DailyBar import at the top of the test file:

```typescript
import type { DailyBar } from './indicator.js';
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/strategy.test.ts
```

Expected: FAIL — `Not implemented`

- [ ] **Step 3: Implement series, value, and sync infrastructure**

In `sdk/src/handles/strategy.ts`, replace the `series` and `value` stubs and add the private sync methods. Add these methods to the `StrategyHandle` class:

```typescript
private async _getLatestClosedTradingDay(): Promise<string> {
  const { data, error } = await this._supabase
    .from('trading_days')
    .select('date')
    .lt('close', new Date().toISOString())
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data.date;
}

private async _getLatestStrategySeriesDate(): Promise<string | null> {
  const row = await this.resolve();
  const { data, error } = await this._supabase
    .from('strategies_series')
    .select('trading_days!inner(date)')
    .eq('strategies_id', row.id)
    .order('trading_day_id', { ascending: false })
    .limit(1)
    .single();

  if (error?.code === 'PGRST116') return null;
  if (error) throw error;
  return (data as unknown as { trading_days: { date: string } }).trading_days.date;
}

private async _ensureFresh(): Promise<void> {
  await this.resolve();
  const latestClosed = await this._getLatestClosedTradingDay();

  if (this._cachedAsOf === latestClosed) return;

  const latestSeries = await this._getLatestStrategySeriesDate();

  if (latestSeries === latestClosed) {
    this._cache = null;
    this._cachedAsOf = latestClosed;
    return;
  }

  if (!this._syncing) {
    this._syncing = this._sync(latestClosed).finally(() => {
      this._syncing = null;
    });
  }
  await this._syncing;

  this._cache = null;
  this._cachedAsOf = latestClosed;
}

private async _sync(latestClosed: string): Promise<void> {
  const row = await this.resolve();

  // Sync all signals and collect their series
  const signalSeries = new Map<number, Map<string, boolean>>();
  const allSignals = new Set<SignalHandle>();
  for (const rule of this._rules) {
    if (rule.when) rule.when.forEach((s) => allSignals.add(s));
  }

  await Promise.all(
    Array.from(allSignals).map(async (signal) => {
      const bars = await signal.series();
      const dateMap = new Map<string, boolean>();
      for (const bar of bars) dateMap.set(bar.date, bar.value === 1);
      signalSeries.set(signal.id, dateMap);
    }),
  );

  // Get all closed trading days
  const { data: tdRows, error: tdError } = await this._supabase
    .from('trading_days')
    .select('id, date')
    .lt('close', new Date().toISOString())
    .order('date', { ascending: true });

  if (tdError) throw tdError;

  const tradingDays = tdRows.map((td: { id: number; date: string }) => td.date);
  const dateToId = new Map<string, number>();
  for (const td of tdRows) dateToId.set(td.date, td.id);

  // Compute rebalance dates
  const rebalanceDates = computeRebalanceDates(tradingDays, this._freq, this._offset);

  // Build allocation index mapping
  const allocations: AllocationHandle[] = [];
  const allocIndexMap = new Map<number, number>();
  const rulesInput = this._rules.map((rule) => {
    let allocIdx = allocIndexMap.get(rule.hold.id);
    if (allocIdx === undefined) {
      allocIdx = allocations.length;
      allocations.push(rule.hold);
      allocIndexMap.set(rule.hold.id, allocIdx);
    }
    return {
      signalIds: (rule.when ?? []).map((s) => s.id),
      allocationIndex: allocIdx,
    };
  });

  // Evaluate
  const evalResult = evaluateStrategy(signalSeries, rulesInput, rebalanceDates, tradingDays);

  // Upsert to strategies_series
  const rows = Array.from(evalResult.entries())
    .filter(([date]) => dateToId.has(date) && date <= latestClosed)
    .map(([date, allocIdx]) => ({
      strategies_id: row.id,
      trading_day_id: dateToId.get(date)!,
      allocation_id: allocations[allocIdx].id,
    }));

  if (rows.length > 0) {
    const { error } = await this._supabase
      .from('strategies_series')
      .upsert(rows, { onConflict: 'strategies_id,trading_day_id' });
    if (error) throw error;
  }
}

private async _querySeriesFromDb(range?: DateRange): Promise<StrategyBar[]> {
  const row = await this.resolve();
  let query = this._supabase
    .from('strategies_series')
    .select('allocation_id, trading_days!inner(date)')
    .eq('strategies_id', row.id)
    .order('trading_day_id', { ascending: true });

  if (range?.from) query = query.gte('trading_days.date', range.from);
  if (range?.to) query = query.lte('trading_days.date', range.to);

  const { data, error } = await query;
  if (error) throw error;

  return (data as unknown as { allocation_id: number; trading_days: { date: string } }[]).map(
    (r) => ({
      date: r.trading_days.date,
      allocation: this._allocationMap.get(r.allocation_id)!,
    }),
  );
}

async series(range?: DateRange): Promise<StrategyBar[]> {
  await this._ensureFresh();
  if (this._cache && !range) return this._cache;
  const bars = await this._querySeriesFromDb(range);
  if (!range) this._cache = bars;
  return bars;
}

async value(date?: string): Promise<AllocationHandle | null> {
  await this._ensureFresh();
  const row = await this.resolve();

  if (date) {
    const { data: td, error: tdError } = await this._supabase
      .from('trading_days')
      .select('id')
      .eq('date', date)
      .single();

    if (tdError?.code === 'PGRST116') return null;
    if (tdError) throw tdError;

    const { data, error } = await this._supabase
      .from('strategies_series')
      .select('allocation_id')
      .eq('strategies_id', row.id)
      .eq('trading_day_id', td.id)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw error;
    return this._allocationMap.get(data.allocation_id) ?? null;
  }

  const { data, error } = await this._supabase
    .from('strategies_series')
    .select('allocation_id')
    .eq('strategies_id', row.id)
    .order('trading_day_id', { ascending: false })
    .limit(1)
    .single();

  if (error?.code === 'PGRST116') return null;
  if (error) throw error;
  return this._allocationMap.get(data.allocation_id) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/handles/strategy.test.ts
```

Expected: PASS — all 12 tests

Note: The series test uses complex mocks. If the mock chain doesn't match exactly, adjust the mock setup to match the actual query patterns used in `_ensureFresh`, `_sync`, and `_querySeriesFromDb`. The test may need iterative refinement to match the exact supabase query chain.

- [ ] **Step 5: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2 && git add sdk/src/handles/strategy.ts sdk/src/handles/strategy.test.ts && git commit -m "feat: implement StrategyHandle series and value with sync"
```

---

### Task 8: Client factory and exports (TDD)

**Files:**
- Modify: `sdk/src/client.ts`
- Modify: `sdk/src/client.test.ts`
- Modify: `sdk/src/handles/index.ts`
- Modify: `sdk/src/index.ts`

- [ ] **Step 1: Write failing test for client.strategy() factory**

Add to `sdk/src/client.test.ts`:

```typescript
import { StrategyHandle } from './handles/strategy.js';
```

Then add a describe block:

```typescript
describe('strategy factory', () => {
  it('creates a StrategyHandle in create mode', () => {
    const client = createClient({ supabase: mockSupabase });
    const spy = client.ticker('SPY');
    const price = client.price(spy);
    const sma = client.sma(spy, 200);
    const bullish = client.gt(price, sma, 5);
    const aggressive = client.allocation([spy, 1.0]);
    const defensive = client.allocation([spy, 1.0]);

    const strategy = client.strategy({
      name: 'Test',
      rules: [{ when: [bullish], hold: aggressive }, { hold: defensive }],
    });

    expect(strategy).toBeInstanceOf(StrategyHandle);
    expect(strategy.name).toBe('Test');
    expect(strategy.rules).toHaveLength(2);
  });

  it('creates a StrategyHandle in reference mode', () => {
    const client = createClient({ supabase: mockSupabase });
    const strategy = client.strategy('abc123');

    expect(strategy).toBeInstanceOf(StrategyHandle);
    expect(strategy.name).toBeNull();
  });
});
```

Note: Adjust `mockSupabase` to match the existing test setup in `client.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/client.test.ts
```

Expected: FAIL — `client.strategy is not a function`

- [ ] **Step 3: Add strategy() to the client interface and implementation**

In `sdk/src/client.ts`:

1. Add import:

```typescript
import { StrategyHandle } from './handles/strategy.js';
import type { StrategyOptions, StrategyRule } from './handles/strategy.js';
```

2. Add to the `LivefolioClient` interface:

```typescript
// Strategies
strategy(linkId: string): StrategyHandle;
strategy(options: StrategyOptions): StrategyHandle;
```

3. Add to the `createClient` return object:

```typescript
strategy: (optionsOrLinkId: StrategyOptions | string) =>
  new StrategyHandle(sb, optionsOrLinkId, config),
```

- [ ] **Step 4: Add exports**

In `sdk/src/handles/index.ts`, add:

```typescript
export { StrategyHandle } from './strategy.js';
export type { StrategyRule, StrategyBar, StrategyOptions } from './strategy.js';
```

In `sdk/src/index.ts`, add:

```typescript
export { StrategyHandle } from './handles/strategy.js';
export type { StrategyRule, StrategyBar, StrategyOptions } from './handles/strategy.js';
```

- [ ] **Step 5: Run client tests**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run src/client.test.ts
```

Expected: PASS

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2/sdk && npx vitest run
```

Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
cd /Users/raksi/Documents/Personal/livefolio-2 && git add sdk/src/client.ts sdk/src/client.test.ts sdk/src/handles/index.ts sdk/src/index.ts && git commit -m "feat: add strategy() factory and exports to public API"
```
