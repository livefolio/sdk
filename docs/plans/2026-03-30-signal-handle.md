# Signal Handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `SignalHandle` with lazy resolution, hysteresis-based signal evaluation, transparent sync, and factory methods `sdk.gt()`, `sdk.lt()`, `sdk.eq()`.

**Architecture:** `SignalHandle` follows the same lazy handle pattern as `TickerHandle` and `IndicatorHandle`. A pure `evaluateSignal()` computation function implements hysteresis with tolerance. The handle orchestrates: ensure indicator freshness → check signal freshness → compute with hysteresis → upsert → cache.

**Tech Stack:** TypeScript, Supabase JS client, Vitest

---

## File Structure

```
sdk/src/
  handles/
    signal.ts            # NEW: SignalHandle class
    indicator.ts         # unchanged
    ticker.ts            # unchanged
    index.ts             # MODIFY: add SignalHandle export
  computations/
    signal.ts            # NEW: evaluateSignal() pure function
    ...                  # existing files unchanged
  client.ts              # MODIFY: add gt(), lt(), eq() factories
  index.ts               # MODIFY: add SignalHandle export
```

---

### Task 1: Signal Evaluation Pure Function

**Files:**
- Create: `src/computations/signal.ts`
- Test: `src/computations/signal.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/computations/signal.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateSignal } from './signal.js';
import type { DailyBar } from '../handles/indicator.js';

function bars(values: number[], startDate = '2025-01-01'): DailyBar[] {
  return values.map((value, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().split('T')[0], value };
  });
}

describe('evaluateSignal — no tolerance (raw comparison)', () => {
  it('> comparison', () => {
    const s1 = bars([10, 5, 15]);
    const s2 = bars([8, 8, 8]);
    const result = evaluateSignal(s1, s2, '>', 0, false);
    expect(result.map((r) => r.value)).toEqual([1, 0, 1]);
  });

  it('< comparison', () => {
    const s1 = bars([5, 10, 3]);
    const s2 = bars([8, 8, 8]);
    const result = evaluateSignal(s1, s2, '<', 0, false);
    expect(result.map((r) => r.value)).toEqual([1, 0, 1]);
  });

  it('= comparison with zero tolerance is exact match', () => {
    const s1 = bars([8, 5, 8]);
    const s2 = bars([8, 8, 8]);
    const result = evaluateSignal(s1, s2, '=', 0, false);
    expect(result.map((r) => r.value)).toEqual([1, 0, 1]);
  });
});

describe('evaluateSignal — relative tolerance with hysteresis', () => {
  it('> with 5% relative tolerance creates buffer zone', () => {
    // s2 = 100, so upperBuffer = 105, lowerBuffer = 95
    // Day 1: s1=103, no previous → raw comparison 103 > 100 = true → 1
    // Day 2: s1=97, previous=1, 97 > 95 (lowerBuffer) → stays 1 (in buffer)
    // Day 3: s1=94, previous=1, 94 < 95 → flips to 0
    // Day 4: s1=103, previous=0, 103 < 105 (upperBuffer) → stays 0 (in buffer)
    // Day 5: s1=106, previous=0, 106 > 105 → flips to 1
    const s1 = bars([103, 97, 94, 103, 106]);
    const s2 = bars([100, 100, 100, 100, 100]);
    const result = evaluateSignal(s1, s2, '>', 5, false);
    expect(result.map((r) => r.value)).toEqual([1, 1, 0, 0, 1]);
  });

  it('< with 5% relative tolerance', () => {
    // s2 = 100, upperBuffer = 105, lowerBuffer = 95
    // Day 1: s1=97, raw 97 < 100 = true → 1
    // Day 2: s1=103, previous=1, 103 < 105 (upperBuffer) → stays 1 (in buffer)
    // Day 3: s1=106, previous=1, 106 > 105 → flips to 0
    // Day 4: s1=97, previous=0, 97 > 95 (lowerBuffer) → stays 0 (in buffer)
    // Day 5: s1=94, previous=0, 94 < 95 → flips to 1
    const s1 = bars([97, 103, 106, 97, 94]);
    const s2 = bars([100, 100, 100, 100, 100]);
    const result = evaluateSignal(s1, s2, '<', 5, false);
    expect(result.map((r) => r.value)).toEqual([1, 1, 0, 0, 1]);
  });

  it('= with 5% relative tolerance creates a range', () => {
    // s2 = 100, upperBuffer = 105, lowerBuffer = 95
    // Inside [95, 105] → 1, outside → 0. No hysteresis for =.
    const s1 = bars([100, 94, 106, 95, 105]);
    const s2 = bars([100, 100, 100, 100, 100]);
    const result = evaluateSignal(s1, s2, '=', 5, false);
    expect(result.map((r) => r.value)).toEqual([1, 0, 0, 1, 1]);
  });
});

describe('evaluateSignal — absolute tolerance with hysteresis', () => {
  it('> with absolute tolerance 2', () => {
    // s2 = 30, upperBuffer = 32, lowerBuffer = 28
    // Day 1: s1=31, raw 31 > 30 = true → 1
    // Day 2: s1=29, previous=1, 29 > 28 → stays 1 (in buffer)
    // Day 3: s1=27, previous=1, 27 < 28 → flips to 0
    // Day 4: s1=31, previous=0, 31 < 32 → stays 0 (in buffer)
    // Day 5: s1=33, previous=0, 33 > 32 → flips to 1
    const s1 = bars([31, 29, 27, 31, 33]);
    const s2 = bars([30, 30, 30, 30, 30]);
    const result = evaluateSignal(s1, s2, '>', 2, true);
    expect(result.map((r) => r.value)).toEqual([1, 1, 0, 0, 1]);
  });
});

describe('evaluateSignal — previousValue for incremental', () => {
  it('continues hysteresis from previous value', () => {
    // s2 = 100, 5% relative: upper=105, lower=95
    // previousValue = 1, so s1=97 stays 1 (in buffer zone above lower)
    const s1 = bars([97, 94]);
    const s2 = bars([100, 100]);
    const result = evaluateSignal(s1, s2, '>', 5, false, 1);
    expect(result.map((r) => r.value)).toEqual([1, 0]);
  });

  it('without previousValue, first bar uses raw comparison', () => {
    // s2 = 100, 5% relative: upper=105, lower=95
    // No previous → raw: 97 < 100, so > comparison is false → 0
    const s1 = bars([97, 94]);
    const s2 = bars([100, 100]);
    const result = evaluateSignal(s1, s2, '>', 5, false);
    expect(result.map((r) => r.value)).toEqual([0, 0]);
  });
});

describe('evaluateSignal — edge cases', () => {
  it('empty series returns empty', () => {
    expect(evaluateSignal([], [], '>', 0, false)).toEqual([]);
  });

  it('mismatched dates are skipped (only aligned dates)', () => {
    const s1: DailyBar[] = [
      { date: '2025-01-01', value: 10 },
      { date: '2025-01-02', value: 20 },
      { date: '2025-01-03', value: 15 },
    ];
    const s2: DailyBar[] = [
      { date: '2025-01-01', value: 8 },
      { date: '2025-01-03', value: 8 },
    ];
    const result = evaluateSignal(s1, s2, '>', 0, false);
    expect(result).toHaveLength(2);
    expect(result[0].date).toBe('2025-01-01');
    expect(result[1].date).toBe('2025-01-03');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/computations/signal.test.ts`
Expected: FAIL — cannot find `./signal.js`

- [ ] **Step 3: Implement evaluateSignal**

```ts
// src/computations/signal.ts
import type { DailyBar } from '../handles/indicator.js';

type Comparison = '>' | '<' | '=';

function computeBuffers(
  v2: number,
  tolerance: number,
  absolute: boolean,
): { upper: number; lower: number } {
  if (tolerance === 0) return { upper: v2, lower: v2 };
  if (absolute) return { upper: v2 + tolerance, lower: v2 - tolerance };
  return { upper: v2 * (1 + tolerance / 100), lower: v2 * (1 - tolerance / 100) };
}

function rawCompare(v1: number, v2: number, comparison: Comparison): number {
  switch (comparison) {
    case '>':
      return v1 > v2 ? 1 : 0;
    case '<':
      return v1 < v2 ? 1 : 0;
    case '=':
      return v1 === v2 ? 1 : 0;
  }
}

export function evaluateSignal(
  series1: DailyBar[],
  series2: DailyBar[],
  comparison: Comparison,
  tolerance: number,
  absolute: boolean,
  previousValue?: number,
): DailyBar[] {
  // Build a map of series2 by date for O(1) lookup
  const s2Map = new Map<string, number>();
  for (const bar of series2) {
    s2Map.set(bar.date, bar.value);
  }

  const result: DailyBar[] = [];
  let prev = previousValue;

  for (const bar1 of series1) {
    const v2 = s2Map.get(bar1.date);
    if (v2 === undefined) continue; // skip dates not in both series

    const v1 = bar1.value;
    const { upper, lower } = computeBuffers(v2, tolerance, absolute);

    let value: number;

    if (tolerance === 0) {
      // No hysteresis — raw comparison every bar
      value = rawCompare(v1, v2, comparison);
    } else if (comparison === '=') {
      // Equality is a range check, no hysteresis
      value = v1 >= lower && v1 <= upper ? 1 : 0;
    } else if (prev === undefined) {
      // First bar — raw comparison without buffer
      value = rawCompare(v1, v2, comparison);
    } else if (comparison === '>') {
      if (prev === 1) {
        // Currently true: flip to false only if below lower buffer
        value = v1 < lower ? 0 : 1;
      } else {
        // Currently false: flip to true only if above upper buffer
        value = v1 > upper ? 1 : 0;
      }
    } else {
      // comparison === '<'
      if (prev === 1) {
        // Currently true: flip to false only if above upper buffer
        value = v1 > upper ? 0 : 1;
      } else {
        // Currently false: flip to true only if below lower buffer
        value = v1 < lower ? 1 : 0;
      }
    }

    result.push({ date: bar1.date, value });
    prev = value;
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/computations/signal.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/computations/signal.ts src/computations/signal.test.ts
git commit -m "feat: add evaluateSignal computation with hysteresis"
```

---

### Task 2: SignalHandle Class

**Files:**
- Create: `src/handles/signal.ts`
- Test: `src/handles/signal.test.ts`

- [ ] **Step 1: Write the failing tests for construction and resolve**

```ts
// src/handles/signal.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SignalHandle } from './signal.js';
import { IndicatorHandle } from './indicator.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';

function mockSupabase() {
  return {} as TypedSupabaseClient;
}

describe('SignalHandle construction', () => {
  it('stores indicator handles, comparison, and tolerance', () => {
    const sb = mockSupabase();
    const ticker = new TickerHandle(sb, 'SPY');
    const ind1 = new IndicatorHandle(sb, {
      type: 'Price', ticker, lookback: 0, delay: 0, unit: null, threshold: null,
    });
    const ind2 = new IndicatorHandle(sb, {
      type: 'SMA', ticker, lookback: 200, delay: 0, unit: null, threshold: null,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 5 });

    expect(handle.indicator1).toBe(ind1);
    expect(handle.indicator2).toBe(ind2);
    expect(handle.comparison).toBe('>');
    expect(handle.tolerance).toBe(5);
  });

  it('defaults tolerance to 0', () => {
    const sb = mockSupabase();
    const ind1 = new IndicatorHandle(sb, {
      type: 'VIX', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null,
    });
    const ind2 = new IndicatorHandle(sb, {
      type: 'Threshold', ticker: null, lookback: 0, delay: 0, unit: null, threshold: 20,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '<', tolerance: 0 });
    expect(handle.tolerance).toBe(0);
  });

  it('throws on .id before resolution', () => {
    const sb = mockSupabase();
    const ind1 = new IndicatorHandle(sb, {
      type: 'VIX', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null,
    });
    const ind2 = new IndicatorHandle(sb, {
      type: 'Threshold', ticker: null, lookback: 0, delay: 0, unit: null, threshold: 20,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 0 });
    expect(() => handle.id).toThrow('not yet resolved');
  });
});

describe('SignalHandle.resolve', () => {
  it('resolves both indicators then upserts signal', async () => {
    const indicatorRow1 = { id: 10, type: 'Price', ticker_id: 1, lookback: 0, delay: 0, unit: null, threshold: null, created_at: '' };
    const indicatorRow2 = { id: 11, type: 'SMA', ticker_id: 1, lookback: 200, delay: 0, unit: null, threshold: null, created_at: '' };
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const signalRow = { id: 100, indicator_id_1: 10, indicator_id_2: 11, comparison: '>', tolerance: 5, created_at: '' };

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
        let callCount = 0;
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockImplementation(() => {
                callCount++;
                return Promise.resolve({
                  data: callCount === 1 ? indicatorRow1 : indicatorRow2,
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
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

    const ticker = new TickerHandle(sb, 'SPY');
    const ind1 = new IndicatorHandle(sb, {
      type: 'Price', ticker, lookback: 0, delay: 0, unit: null, threshold: null,
    });
    const ind2 = new IndicatorHandle(sb, {
      type: 'SMA', ticker, lookback: 200, delay: 0, unit: null, threshold: null,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 5 });

    const result = await handle.resolve();

    expect(result).toEqual(signalRow);
    expect(handle.id).toBe(100);
    expect(sb.from).toHaveBeenCalledWith('signals');
  });

  it('caches resolution', async () => {
    const signalRow = { id: 100, indicator_id_1: 10, indicator_id_2: 11, comparison: '>', tolerance: 0, created_at: '' };
    const indicatorRow = { id: 10, type: 'VIX', ticker_id: null, lookback: 0, delay: 0, unit: null, threshold: null, created_at: '' };

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'indicators') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: indicatorRow, error: null }),
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
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

    const ind1 = new IndicatorHandle(sb, {
      type: 'VIX', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null,
    });
    const ind2 = new IndicatorHandle(sb, {
      type: 'Threshold', ticker: null, lookback: 0, delay: 0, unit: null, threshold: 20,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 0 });

    await handle.resolve();
    await handle.resolve();

    // signals table should only be called once (upsert is on first resolve)
    const signalCalls = from.mock.calls.filter((c: string[]) => c[0] === 'signals');
    expect(signalCalls.length).toBe(1);
  });

  it('deduplicates concurrent resolve calls', async () => {
    const signalRow = { id: 100, indicator_id_1: 10, indicator_id_2: 11, comparison: '>', tolerance: 0, created_at: '' };
    const indicatorRow = { id: 10, type: 'VIX', ticker_id: null, lookback: 0, delay: 0, unit: null, threshold: null, created_at: '' };

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'indicators') {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: indicatorRow, error: null }),
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
      return {};
    });
    const sb = { from } as unknown as TypedSupabaseClient;

    const ind1 = new IndicatorHandle(sb, {
      type: 'VIX', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null,
    });
    const ind2 = new IndicatorHandle(sb, {
      type: 'Threshold', ticker: null, lookback: 0, delay: 0, unit: null, threshold: 20,
    });
    const handle = new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: 0 });

    const [r1, r2] = await Promise.all([handle.resolve(), handle.resolve()]);
    expect(r1).toEqual(r2);
    const signalCalls = from.mock.calls.filter((c: string[]) => c[0] === 'signals');
    expect(signalCalls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/handles/signal.test.ts`
Expected: FAIL — cannot find `./signal.js`

- [ ] **Step 3: Implement SignalHandle**

```ts
// src/handles/signal.ts
import type { TypedSupabaseClient } from '../types.js';
import type { Tables, Database } from '../database.types.js';
import type { IndicatorHandle, DailyBar, DateRange, IndicatorConfig } from './indicator.js';
import { evaluateSignal } from '../computations/signal.js';

type SignalRow = Tables<'signals'>;
type Comparison = Database['public']['Enums']['comparison'];

const ABSOLUTE_TOLERANCE_TYPES = new Set([
  'Return', 'Volatility', 'Drawdown', 'VIX', 'VIX3M',
  'T3M', 'T6M', 'T1Y', 'T2Y', 'T3Y', 'T5Y', 'T7Y', 'T10Y', 'T20Y', 'T30Y',
]);

export interface SignalIdentity {
  indicator1: IndicatorHandle;
  indicator2: IndicatorHandle;
  comparison: Comparison;
  tolerance: number;
}

export class SignalHandle {
  readonly indicator1: IndicatorHandle;
  readonly indicator2: IndicatorHandle;
  readonly comparison: Comparison;
  readonly tolerance: number;

  private _supabase: TypedSupabaseClient;
  private _config: IndicatorConfig;
  private _resolved: SignalRow | null = null;
  private _resolving: Promise<SignalRow> | null = null;

  private _cachedSeries: DailyBar[] | null = null;
  private _cachedAsOf: string | null = null;
  private _syncing: Promise<void> | null = null;

  constructor(supabase: TypedSupabaseClient, identity: SignalIdentity, config?: IndicatorConfig) {
    this._supabase = supabase;
    this._config = config ?? {};
    this.indicator1 = identity.indicator1;
    this.indicator2 = identity.indicator2;
    this.comparison = identity.comparison;
    this.tolerance = identity.tolerance;
  }

  get id(): number {
    if (!this._resolved)
      throw new Error('SignalHandle not yet resolved. Call resolve(), or access via an async method.');
    return this._resolved.id;
  }

  async resolve(): Promise<SignalRow> {
    if (this._resolved) return this._resolved;
    if (!this._resolving) this._resolving = this._doResolve();
    return this._resolving;
  }

  private async _doResolve(): Promise<SignalRow> {
    const [ind1Row, ind2Row] = await Promise.all([
      this.indicator1.resolve(),
      this.indicator2.resolve(),
    ]);

    const { data, error } = await this._supabase
      .from('signals')
      .upsert(
        {
          indicator_id_1: ind1Row.id,
          indicator_id_2: ind2Row.id,
          comparison: this.comparison,
          tolerance: this.tolerance,
        },
        { onConflict: 'indicator_id_1,indicator_id_2,comparison,tolerance' },
      )
      .select()
      .single();

    if (error) throw error;
    this._resolved = data;
    return data;
  }

  // ── Freshness & Sync ───────────────────────────────────────────────

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

  private async _getLatestSignalSeriesDate(signalId: number): Promise<string | null> {
    const { data, error } = await this._supabase
      .from('signals_series')
      .select('trading_days!inner(date)')
      .eq('signal_id', signalId)
      .order('trading_day_id', { ascending: false })
      .limit(1)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw error;
    return (data as unknown as { trading_days: { date: string } }).trading_days.date;
  }

  private async _getLastSignalValue(signalId: number): Promise<number | undefined> {
    const { data, error } = await this._supabase
      .from('signals_series')
      .select('value')
      .eq('signal_id', signalId)
      .order('trading_day_id', { ascending: false })
      .limit(1)
      .single();

    if (error?.code === 'PGRST116') return undefined;
    if (error) throw error;
    return data.value ? 1 : 0;
  }

  private async _ensureFresh(): Promise<void> {
    const row = await this.resolve();
    const latestClosed = await this._getLatestClosedTradingDay();

    if (this._cachedAsOf === latestClosed) return;

    // Ensure both indicators are fresh first
    await Promise.all([
      this.indicator1.series(),
      this.indicator2.series(),
    ]);

    const latestSeries = await this._getLatestSignalSeriesDate(row.id);

    if (latestSeries === latestClosed) {
      this._cachedSeries = null;
      this._cachedAsOf = latestClosed;
      return;
    }

    if (!this._syncing) {
      this._syncing = this._sync(latestSeries ?? undefined, latestClosed).finally(() => {
        this._syncing = null;
      });
    }
    await this._syncing;

    this._cachedSeries = null;
    this._cachedAsOf = latestClosed;
  }

  private async _sync(fromDate: string | undefined, latestClosed: string): Promise<void> {
    const row = await this.resolve();

    // Read both indicator series (already fresh from _ensureFresh)
    const range = fromDate ? { from: fromDate } : undefined;
    const [series1, series2] = await Promise.all([
      this.indicator1.series(range),
      this.indicator2.series(range),
    ]);

    // Get previous signal value for hysteresis continuity
    const previousValue = fromDate ? await this._getLastSignalValue(row.id) : undefined;

    const absolute = ABSOLUTE_TOLERANCE_TYPES.has(this.indicator1.type);
    const signalBars = evaluateSignal(series1, series2, this.comparison, this.tolerance, absolute, previousValue);

    // Filter to latestClosed
    const bars = signalBars.filter((b) => b.date <= latestClosed);

    if (bars.length > 0) {
      await this._upsertSeries(bars);
    }
  }

  private async _upsertSeries(bars: DailyBar[]): Promise<void> {
    const row = await this.resolve();
    const dates = bars.map((b) => b.date);

    const { data: tradingDays, error: tdError } = await this._supabase
      .from('trading_days')
      .select('id, date')
      .in('date', dates);

    if (tdError) throw tdError;

    const dateToId = new Map<string, number>();
    for (const td of tradingDays) {
      dateToId.set(td.date, td.id);
    }

    const rows = bars
      .filter((b) => dateToId.has(b.date))
      .map((b) => ({
        signal_id: row.id,
        trading_day_id: dateToId.get(b.date)!,
        value: b.value === 1,
      }));

    if (rows.length === 0) return;

    const { error } = await this._supabase
      .from('signals_series')
      .upsert(rows, { onConflict: 'signal_id,trading_day_id' });

    if (error) throw error;
  }

  private async _querySeriesFromDb(range?: DateRange): Promise<DailyBar[]> {
    const row = await this.resolve();
    let query = this._supabase
      .from('signals_series')
      .select('value, trading_days!inner(date)')
      .eq('signal_id', row.id)
      .order('trading_day_id', { ascending: true });

    if (range?.from) query = query.gte('trading_days.date', range.from);
    if (range?.to) query = query.lte('trading_days.date', range.to);

    const { data, error } = await query;
    if (error) throw error;
    return (data as unknown as { value: boolean; trading_days: { date: string } }[]).map((r) => ({
      date: r.trading_days.date,
      value: r.value ? 1 : 0,
    }));
  }

  // ── Public data access ─────────────────────────────────────────────

  async series(range?: DateRange): Promise<DailyBar[]> {
    await this._ensureFresh();
    if (this._cachedSeries && !range) return this._cachedSeries;
    const bars = await this._querySeriesFromDb(range);
    if (!range) this._cachedSeries = bars;
    return bars;
  }

  async value(date?: string): Promise<number | null> {
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
        .from('signals_series')
        .select('value')
        .eq('signal_id', row.id)
        .eq('trading_day_id', td.id)
        .single();

      if (error?.code === 'PGRST116') return null;
      if (error) throw error;
      return data.value ? 1 : 0;
    }

    const { data, error } = await this._supabase
      .from('signals_series')
      .select('value')
      .eq('signal_id', row.id)
      .order('trading_day_id', { ascending: false })
      .limit(1)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (error) throw error;
    return data.value ? 1 : 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/handles/signal.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/handles/signal.ts src/handles/signal.test.ts
git commit -m "feat: add SignalHandle with lazy resolution, sync, and hysteresis"
```

---

### Task 3: Barrel Exports & Client Factories

**Files:**
- Modify: `src/handles/index.ts`
- Modify: `src/client.ts`
- Modify: `src/index.ts`
- Test: `src/client.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/client.test.ts`:

```ts
import { SignalHandle } from './handles/signal.js';

describe('signal factories', () => {
  const sdk = createClient({ supabase: testSupabase() });
  const spy = sdk.ticker('SPY');
  const price = sdk.price(spy);
  const sma = sdk.sma(spy, 200);

  it('sdk.gt()', () => {
    const h = sdk.gt(price, sma);
    expect(h).toBeInstanceOf(SignalHandle);
    expect(h.comparison).toBe('>');
    expect(h.tolerance).toBe(0);
    expect(h.indicator1).toBe(price);
    expect(h.indicator2).toBe(sma);
  });

  it('sdk.gt() with tolerance', () => {
    const h = sdk.gt(price, sma, 5);
    expect(h.tolerance).toBe(5);
  });

  it('sdk.lt()', () => {
    const h = sdk.lt(price, sma);
    expect(h).toBeInstanceOf(SignalHandle);
    expect(h.comparison).toBe('<');
  });

  it('sdk.eq()', () => {
    const h = sdk.eq(price, sma, 1);
    expect(h).toBeInstanceOf(SignalHandle);
    expect(h.comparison).toBe('=');
    expect(h.tolerance).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/client.test.ts`
Expected: FAIL — `sdk.gt` is not a function

- [ ] **Step 3: Update handles barrel**

```ts
// src/handles/index.ts
export { TickerHandle } from './ticker.js';
export { IndicatorHandle } from './indicator.js';
export type { IndicatorIdentity, DateRange, DailyBar, IndicatorConfig } from './indicator.js';
export { SignalHandle } from './signal.js';
export type { SignalIdentity } from './signal.js';
```

- [ ] **Step 4: Add signal factories to client.ts**

Add import at top:

```ts
import { SignalHandle } from './handles/signal.js';
import type { IndicatorConfig } from './handles/indicator.js';
```

Add to `LivefolioClient` interface:

```ts
  // Signals
  gt(ind1: IndicatorHandle, ind2: IndicatorHandle, tolerance?: number): SignalHandle;
  lt(ind1: IndicatorHandle, ind2: IndicatorHandle, tolerance?: number): SignalHandle;
  eq(ind1: IndicatorHandle, ind2: IndicatorHandle, tolerance?: number): SignalHandle;
```

Add to the return object in `createClient`:

```ts
    gt: (ind1, ind2, tolerance?) =>
      new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '>', tolerance: tolerance ?? 0 }, config),
    lt: (ind1, ind2, tolerance?) =>
      new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '<', tolerance: tolerance ?? 0 }, config),
    eq: (ind1, ind2, tolerance?) =>
      new SignalHandle(sb, { indicator1: ind1, indicator2: ind2, comparison: '=', tolerance: tolerance ?? 0 }, config),
```

- [ ] **Step 5: Update root index.ts**

```ts
// src/index.ts
export { createClient } from './client.js';
export type { LivefolioClient, LivefolioClientOptions } from './client.js';
export type { TypedSupabaseClient, Database } from './types.js';
export { TickerHandle } from './handles/ticker.js';
export { IndicatorHandle } from './handles/indicator.js';
export type { IndicatorIdentity, DateRange, DailyBar } from './handles/indicator.js';
export { SignalHandle } from './handles/signal.js';
export type { SignalIdentity } from './handles/signal.js';
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 7: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/handles/index.ts src/client.ts src/client.test.ts src/index.ts
git commit -m "feat: add gt(), lt(), eq() signal factory methods to client"
```

---

### Task 4: Build Verification & README Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Clean build**

```bash
npm run clean && npm run build
```

Expected: compiles without errors

- [ ] **Step 2: Verify exports**

```bash
node -e "import('@livefolio/sdk').then(m => console.log(Object.keys(m)))"
```

Expected: prints `['IndicatorHandle', 'SignalHandle', 'TickerHandle', 'createClient']`

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 4: Add signals section to README.md**

After the "Threshold" section in the API Reference, add:

```markdown
### Signals

Compare two indicators to create a boolean signal. Supports hysteresis via tolerance to reduce whipsawing.

\`\`\`ts
sdk.gt(ind1, ind2, tolerance?)    // ind1 > ind2
sdk.lt(ind1, ind2, tolerance?)    // ind1 < ind2
sdk.eq(ind1, ind2, tolerance?)    // ind1 ≈ ind2 (within tolerance range)
\`\`\`

Tolerance defaults to `0` (no hysteresis). When set, a buffer zone prevents the signal from flipping until the indicator moves fully through the buffer.

- **Relative tolerance** (Price, SMA, EMA, RSI, Threshold, Calendar): buffer = `ind2 * (1 ± tolerance/100)`
- **Absolute tolerance** (Return, Volatility, Drawdown, VIX, VIX3M, Treasury): buffer = `ind2 ± tolerance`

\`\`\`ts
const spy = sdk.ticker('SPY')
const price = sdk.price(spy)
const sma200 = sdk.sma(spy, 200)

const bullish = sdk.gt(price, sma200, 5)    // 5% tolerance

const series = await bullish.series()         // DailyBar[] with value 0 or 1
const current = await bullish.value()         // 0 or 1
\`\`\`

Signal handles support the same `.series(range?)`, `.value(date?)`, and `.resolve()` methods as indicator handles. Data is automatically synced — both underlying indicators are refreshed before computing the signal.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add signals section to README"
```
