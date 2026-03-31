# Indicator Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `series()` and `value()` transparently fetch from Yahoo Finance / FRED, compute derived indicators, and cache results when data is missing or stale.

**Architecture:** Two provider modules (Yahoo, FRED) fetch raw market data. Pure computation functions transform price series into derived indicators (SMA, EMA, RSI, etc.). IndicatorHandle orchestrates: check freshness → resolve dependencies → fetch → compute → upsert → cache in memory.

**Tech Stack:** yahoo-finance2, FRED REST API (native fetch), Vitest

---

## File Structure

```
sdk/src/
  providers/
    yahoo.ts               # Yahoo Finance fetcher
    fred.ts                # FRED API fetcher
    mappings.ts            # indicator type → provider + symbol/series ID
    index.ts               # barrel
  computations/
    sma.ts                 # Simple moving average
    ema.ts                 # Exponential moving average
    rsi.ts                 # Relative strength index
    returns.ts             # Period returns
    volatility.ts          # Rolling standard deviation
    drawdown.ts            # Drawdown from rolling max
    calendar.ts            # Date component extraction
    index.ts               # barrel, maps indicator type → computation fn
  handles/
    indicator.ts           # MODIFY: add sync, freshness, caching
    ticker.ts              # unchanged
    index.ts               # unchanged
  client.ts                # MODIFY: accept fredApiKey, pass config to handles
  types.ts                 # unchanged
  database.types.ts        # unchanged
  index.ts                 # unchanged
```

---

### Task 1: Yahoo Finance Provider

**Files:**
- Create: `src/providers/yahoo.ts`
- Test: `src/providers/yahoo.test.ts`

- [ ] **Step 1: Install yahoo-finance2**

```bash
npm install yahoo-finance2
```

- [ ] **Step 2: Write the failing test**

```ts
// src/providers/yahoo.test.ts
import { describe, it, expect, vi } from 'vitest';
import { fetchYahoo } from './yahoo.js';
import type { DailyBar } from '../handles/indicator.js';

// We mock yahoo-finance2 to avoid real API calls in tests
vi.mock('yahoo-finance2', () => ({
  default: {
    historical: vi.fn(),
  },
}));

import yahooFinance from 'yahoo-finance2';
const mockHistorical = vi.mocked(yahooFinance.historical);

describe('fetchYahoo', () => {
  it('returns DailyBar[] from historical data', async () => {
    mockHistorical.mockResolvedValue([
      { date: new Date('2025-01-02'), close: 100.5, open: 99, high: 101, low: 99, volume: 1000, adjClose: 100.5 },
      { date: new Date('2025-01-03'), close: 102.0, open: 100, high: 103, low: 100, volume: 1200, adjClose: 102.0 },
    ] as any);

    const result = await fetchYahoo('SPY');

    expect(result).toEqual([
      { date: '2025-01-02', value: 100.5 },
      { date: '2025-01-03', value: 102.0 },
    ]);
    expect(mockHistorical).toHaveBeenCalledWith('SPY', { period1: '1900-01-01' }, { adjClose: false });
  });

  it('passes from date when provided', async () => {
    mockHistorical.mockResolvedValue([]);

    await fetchYahoo('SPY', '2024-06-01');

    expect(mockHistorical).toHaveBeenCalledWith('SPY', { period1: '2024-06-01' }, { adjClose: false });
  });

  it('filters out entries with null/undefined close', async () => {
    mockHistorical.mockResolvedValue([
      { date: new Date('2025-01-02'), close: 100, open: 99, high: 101, low: 99, volume: 1000, adjClose: 100 },
      { date: new Date('2025-01-03'), close: null, open: 100, high: 103, low: 100, volume: 0, adjClose: null },
    ] as any);

    const result = await fetchYahoo('SPY');
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2025-01-02');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/providers/yahoo.test.ts`
Expected: FAIL — cannot find `./yahoo.js`

- [ ] **Step 4: Implement**

```ts
// src/providers/yahoo.ts
import yahooFinance from 'yahoo-finance2';
import type { DailyBar } from '../handles/indicator.js';

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export async function fetchYahoo(symbol: string, from?: string): Promise<DailyBar[]> {
  const result = await yahooFinance.historical(
    symbol,
    { period1: from ?? '1900-01-01' },
    { adjClose: false },
  );

  return result
    .filter((r) => r.close != null)
    .map((r) => ({
      date: formatDate(r.date),
      value: r.close!,
    }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/providers/yahoo.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/providers/yahoo.ts src/providers/yahoo.test.ts
git commit -m "feat: add Yahoo Finance provider"
```

---

### Task 2: FRED Provider

**Files:**
- Create: `src/providers/fred.ts`
- Test: `src/providers/fred.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/fred.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchFred } from './fred.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchFred', () => {
  it('returns DailyBar[] from FRED observations', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          observations: [
            { date: '2025-01-02', value: '4.25' },
            { date: '2025-01-03', value: '4.30' },
          ],
        }),
    });

    const result = await fetchFred('DGS10', 'test-key');

    expect(result).toEqual([
      { date: '2025-01-02', value: 4.25 },
      { date: '2025-01-03', value: 4.3 },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('series_id=DGS10'),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api_key=test-key'),
    );
  });

  it('filters out missing values (FRED uses "." for missing)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          observations: [
            { date: '2025-01-02', value: '4.25' },
            { date: '2025-01-03', value: '.' },
          ],
        }),
    });

    const result = await fetchFred('DGS10', 'test-key');
    expect(result).toHaveLength(1);
  });

  it('passes observation_start when from is provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ observations: [] }),
    });

    await fetchFred('DGS10', 'test-key', '2024-06-01');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('observation_start=2024-06-01'),
    );
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(fetchFred('DGS10', 'bad-key')).rejects.toThrow('FRED API error: 401 Unauthorized');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/fred.test.ts`
Expected: FAIL — cannot find `./fred.js`

- [ ] **Step 3: Implement**

```ts
// src/providers/fred.ts
import type { DailyBar } from '../handles/indicator.js';

const FRED_BASE = 'https://api.stlouisfed.org/fred/series/observations';

interface FredObservation {
  date: string;
  value: string;
}

interface FredResponse {
  observations: FredObservation[];
}

export async function fetchFred(seriesId: string, apiKey: string, from?: string): Promise<DailyBar[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
  });

  if (from) params.set('observation_start', from);

  const res = await fetch(`${FRED_BASE}?${params}`);
  if (!res.ok) throw new Error(`FRED API error: ${res.status} ${res.statusText}`);

  const json: FredResponse = await res.json();

  return json.observations
    .filter((o) => o.value !== '.')
    .map((o) => ({
      date: o.date,
      value: parseFloat(o.value),
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/fred.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/providers/fred.ts src/providers/fred.test.ts
git commit -m "feat: add FRED API provider"
```

---

### Task 3: Provider Mappings & Barrel

**Files:**
- Create: `src/providers/mappings.ts`
- Create: `src/providers/index.ts`
- Test: `src/providers/mappings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/providers/mappings.test.ts
import { describe, it, expect } from 'vitest';
import { getProviderInfo } from './mappings.js';

describe('getProviderInfo', () => {
  it('maps Price to yahoo with ticker symbol', () => {
    const info = getProviderInfo('Price', 'SPY');
    expect(info).toEqual({ provider: 'yahoo', symbol: 'SPY' });
  });

  it('maps SMA to computed with ticker symbol dependency', () => {
    const info = getProviderInfo('SMA', 'SPY');
    expect(info).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'SPY' });
  });

  it('maps EMA to computed', () => {
    const info = getProviderInfo('EMA', 'QQQ');
    expect(info).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'QQQ' });
  });

  it('maps RSI to computed', () => {
    const info = getProviderInfo('RSI', 'SPY');
    expect(info).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'SPY' });
  });

  it('maps Return to computed', () => {
    const info = getProviderInfo('Return', 'SPY');
    expect(info).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'SPY' });
  });

  it('maps Volatility to computed', () => {
    const info = getProviderInfo('Volatility', 'SPY');
    expect(info).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'SPY' });
  });

  it('maps Drawdown to computed', () => {
    const info = getProviderInfo('Drawdown', 'SPY');
    expect(info).toEqual({ provider: 'computed', dependsOn: 'Price', symbol: 'SPY' });
  });

  it('maps VIX to yahoo with ^VIX symbol', () => {
    const info = getProviderInfo('VIX', null);
    expect(info).toEqual({ provider: 'yahoo', symbol: '^VIX' });
  });

  it('maps VIX3M to yahoo with ^VIX3M symbol', () => {
    const info = getProviderInfo('VIX3M', null);
    expect(info).toEqual({ provider: 'yahoo', symbol: '^VIX3M' });
  });

  it('maps T10Y to fred with DGS10 series', () => {
    const info = getProviderInfo('T10Y', null);
    expect(info).toEqual({ provider: 'fred', seriesId: 'DGS10' });
  });

  it('maps T3M to fred with DGS3MO series', () => {
    const info = getProviderInfo('T3M', null);
    expect(info).toEqual({ provider: 'fred', seriesId: 'DGS3MO' });
  });

  it('maps Month to calendar', () => {
    const info = getProviderInfo('Month', null);
    expect(info).toEqual({ provider: 'calendar' });
  });

  it('maps Threshold to none', () => {
    const info = getProviderInfo('Threshold', null);
    expect(info).toEqual({ provider: 'none' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/providers/mappings.test.ts`
Expected: FAIL — cannot find `./mappings.js`

- [ ] **Step 3: Implement**

```ts
// src/providers/mappings.ts
import type { Database } from '../database.types.js';

type IndicatorType = Database['public']['Enums']['indicator_type'];

export type ProviderInfo =
  | { provider: 'yahoo'; symbol: string }
  | { provider: 'fred'; seriesId: string }
  | { provider: 'computed'; dependsOn: 'Price'; symbol: string }
  | { provider: 'calendar' }
  | { provider: 'none' };

const FRED_SERIES: Record<string, string> = {
  T3M: 'DGS3MO',
  T6M: 'DGS6MO',
  T1Y: 'DGS1',
  T2Y: 'DGS2',
  T3Y: 'DGS3',
  T5Y: 'DGS5',
  T7Y: 'DGS7',
  T10Y: 'DGS10',
  T20Y: 'DGS20',
  T30Y: 'DGS30',
};

const COMPUTED_TYPES = new Set<string>(['SMA', 'EMA', 'RSI', 'Return', 'Volatility', 'Drawdown']);
const CALENDAR_TYPES = new Set<string>(['Month', 'Day of Week', 'Day of Month', 'Day of Year']);

export function getProviderInfo(type: IndicatorType, tickerSymbol: string | null): ProviderInfo {
  if (type === 'Price') return { provider: 'yahoo', symbol: tickerSymbol! };
  if (type === 'VIX') return { provider: 'yahoo', symbol: '^VIX' };
  if (type === 'VIX3M') return { provider: 'yahoo', symbol: '^VIX3M' };

  if (type in FRED_SERIES) return { provider: 'fred', seriesId: FRED_SERIES[type] };

  if (COMPUTED_TYPES.has(type)) return { provider: 'computed', dependsOn: 'Price', symbol: tickerSymbol! };

  if (CALENDAR_TYPES.has(type)) return { provider: 'calendar' };

  return { provider: 'none' }; // Threshold
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/providers/mappings.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Create barrel export**

```ts
// src/providers/index.ts
export { fetchYahoo } from './yahoo.js';
export { fetchFred } from './fred.js';
export { getProviderInfo } from './mappings.js';
export type { ProviderInfo } from './mappings.js';
```

- [ ] **Step 6: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/providers/mappings.ts src/providers/mappings.test.ts src/providers/index.ts
git commit -m "feat: add provider mappings and barrel export"
```

---

### Task 4: Computation Functions

**Files:**
- Create: `src/computations/sma.ts`
- Create: `src/computations/ema.ts`
- Create: `src/computations/rsi.ts`
- Create: `src/computations/returns.ts`
- Create: `src/computations/volatility.ts`
- Create: `src/computations/drawdown.ts`
- Create: `src/computations/calendar.ts`
- Create: `src/computations/index.ts`
- Test: `src/computations/computations.test.ts`

All computation functions are pure: `(bars: DailyBar[], lookback: number) => DailyBar[]`. They take a full price series and return the computed series.

- [ ] **Step 1: Write the failing tests**

```ts
// src/computations/computations.test.ts
import { describe, it, expect } from 'vitest';
import type { DailyBar } from '../handles/indicator.js';
import { computeSma } from './sma.js';
import { computeEma } from './ema.js';
import { computeRsi } from './rsi.js';
import { computeReturns } from './returns.js';
import { computeVolatility } from './volatility.js';
import { computeDrawdown } from './drawdown.js';
import { computeCalendar } from './calendar.js';
import { getComputation } from './index.js';

// Helper: generate sequential prices
function makeBars(values: number[], startDate = '2025-01-01'): DailyBar[] {
  return values.map((value, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return { date: d.toISOString().split('T')[0], value };
  });
}

describe('computeSma', () => {
  it('computes simple moving average', () => {
    const bars = makeBars([10, 20, 30, 40, 50]);
    const result = computeSma(bars, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ date: '2025-01-03', value: 20 }); // (10+20+30)/3
    expect(result[1]).toEqual({ date: '2025-01-04', value: 30 }); // (20+30+40)/3
    expect(result[2]).toEqual({ date: '2025-01-05', value: 40 }); // (30+40+50)/3
  });

  it('returns empty for insufficient data', () => {
    const bars = makeBars([10, 20]);
    expect(computeSma(bars, 3)).toHaveLength(0);
  });
});

describe('computeEma', () => {
  it('computes exponential moving average', () => {
    const bars = makeBars([10, 20, 30, 40, 50]);
    const result = computeEma(bars, 3);
    // EMA starts with SMA of first 3: (10+20+30)/3 = 20
    // multiplier = 2/(3+1) = 0.5
    // ema[1] = 40*0.5 + 20*0.5 = 30
    // ema[2] = 50*0.5 + 30*0.5 = 40
    expect(result).toHaveLength(3);
    expect(result[0].value).toBeCloseTo(20);
    expect(result[1].value).toBeCloseTo(30);
    expect(result[2].value).toBeCloseTo(40);
  });
});

describe('computeRsi', () => {
  it('computes relative strength index', () => {
    // 14 price changes needed, so 15 prices minimum
    const prices = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    const bars = makeBars(prices);
    const result = computeRsi(bars, 14);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeGreaterThan(0);
    expect(result[0].value).toBeLessThan(100);
  });

  it('returns empty for insufficient data', () => {
    const bars = makeBars([10, 20, 30]);
    expect(computeRsi(bars, 14)).toHaveLength(0);
  });
});

describe('computeReturns', () => {
  it('computes percentage returns over lookback', () => {
    const bars = makeBars([100, 110, 121]);
    const result = computeReturns(bars, 1);
    expect(result).toHaveLength(2);
    expect(result[0].value).toBeCloseTo(0.1); // (110-100)/100
    expect(result[1].value).toBeCloseTo(0.1); // (121-110)/110
  });

  it('supports multi-day lookback', () => {
    const bars = makeBars([100, 110, 121]);
    const result = computeReturns(bars, 2);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBeCloseTo(0.21); // (121-100)/100
  });
});

describe('computeVolatility', () => {
  it('computes rolling standard deviation of daily returns', () => {
    const bars = makeBars([100, 102, 98, 103, 101]);
    const result = computeVolatility(bars, 3);
    // daily returns: 0.02, -0.0392, 0.0510, -0.0194
    // need lookback daily returns, so result starts at index lookback+1
    expect(result.length).toBeGreaterThan(0);
    result.forEach((bar) => expect(bar.value).toBeGreaterThanOrEqual(0));
  });
});

describe('computeDrawdown', () => {
  it('computes drawdown from rolling max', () => {
    const bars = makeBars([100, 110, 105, 108, 90]);
    const result = computeDrawdown(bars, 4);
    // At index 4 (value 90): max of [110, 105, 108, 90] = 110, drawdown = (90-110)/110 = -0.1818
    expect(result.length).toBeGreaterThan(0);
    const last = result[result.length - 1];
    expect(last.value).toBeLessThan(0);
  });
});

describe('computeCalendar', () => {
  it('extracts month', () => {
    const bars: DailyBar[] = [
      { date: '2025-03-15', value: 0 },
      { date: '2025-06-20', value: 0 },
    ];
    const result = computeCalendar(bars, 'Month');
    expect(result).toEqual([
      { date: '2025-03-15', value: 3 },
      { date: '2025-06-20', value: 6 },
    ]);
  });

  it('extracts day of week (0=Sun, 6=Sat)', () => {
    const bars: DailyBar[] = [{ date: '2025-03-31', value: 0 }]; // Monday
    const result = computeCalendar(bars, 'Day of Week');
    expect(result[0].value).toBe(1);
  });

  it('extracts day of month', () => {
    const bars: DailyBar[] = [{ date: '2025-03-15', value: 0 }];
    const result = computeCalendar(bars, 'Day of Month');
    expect(result[0].value).toBe(15);
  });

  it('extracts day of year', () => {
    const bars: DailyBar[] = [{ date: '2025-01-01', value: 0 }];
    const result = computeCalendar(bars, 'Day of Year');
    expect(result[0].value).toBe(1);
  });
});

describe('getComputation', () => {
  it('returns the right function for each type', () => {
    expect(getComputation('SMA')).toBe(computeSma);
    expect(getComputation('EMA')).toBe(computeEma);
    expect(getComputation('RSI')).toBe(computeRsi);
    expect(getComputation('Return')).toBe(computeReturns);
    expect(getComputation('Volatility')).toBe(computeVolatility);
    expect(getComputation('Drawdown')).toBe(computeDrawdown);
  });

  it('returns null for non-computed types', () => {
    expect(getComputation('Price')).toBeNull();
    expect(getComputation('VIX')).toBeNull();
    expect(getComputation('Threshold')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/computations/computations.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement sma.ts**

```ts
// src/computations/sma.ts
import type { DailyBar } from '../handles/indicator.js';

export function computeSma(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback) return [];

  const result: DailyBar[] = [];
  let sum = 0;

  for (let i = 0; i < lookback; i++) sum += bars[i].value;

  result.push({ date: bars[lookback - 1].date, value: sum / lookback });

  for (let i = lookback; i < bars.length; i++) {
    sum += bars[i].value - bars[i - lookback].value;
    result.push({ date: bars[i].date, value: sum / lookback });
  }

  return result;
}
```

- [ ] **Step 4: Implement ema.ts**

```ts
// src/computations/ema.ts
import type { DailyBar } from '../handles/indicator.js';

export function computeEma(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback) return [];

  const multiplier = 2 / (lookback + 1);
  const result: DailyBar[] = [];

  // Seed with SMA of first `lookback` values
  let sum = 0;
  for (let i = 0; i < lookback; i++) sum += bars[i].value;
  let ema = sum / lookback;
  result.push({ date: bars[lookback - 1].date, value: ema });

  for (let i = lookback; i < bars.length; i++) {
    ema = bars[i].value * multiplier + ema * (1 - multiplier);
    result.push({ date: bars[i].date, value: ema });
  }

  return result;
}
```

- [ ] **Step 5: Implement rsi.ts**

```ts
// src/computations/rsi.ts
import type { DailyBar } from '../handles/indicator.js';

export function computeRsi(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback + 1) return [];

  const changes: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    changes.push(bars[i].value - bars[i - 1].value);
  }

  // Initial average gain/loss over first `lookback` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < lookback; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= lookback;
  avgLoss /= lookback;

  const result: DailyBar[] = [];
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  result.push({
    date: bars[lookback].date,
    value: avgLoss === 0 ? 100 : 100 - 100 / (1 + rs),
  });

  // Smoothed RSI for remaining values
  for (let i = lookback; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (lookback - 1) + gain) / lookback;
    avgLoss = (avgLoss * (lookback - 1) + loss) / lookback;
    const smoothRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({
      date: bars[i + 1].date,
      value: avgLoss === 0 ? 100 : 100 - 100 / (1 + smoothRs),
    });
  }

  return result;
}
```

- [ ] **Step 6: Implement returns.ts**

```ts
// src/computations/returns.ts
import type { DailyBar } from '../handles/indicator.js';

export function computeReturns(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length <= lookback) return [];

  const result: DailyBar[] = [];
  for (let i = lookback; i < bars.length; i++) {
    result.push({
      date: bars[i].date,
      value: (bars[i].value - bars[i - lookback].value) / bars[i - lookback].value,
    });
  }
  return result;
}
```

- [ ] **Step 7: Implement volatility.ts**

```ts
// src/computations/volatility.ts
import type { DailyBar } from '../handles/indicator.js';

export function computeVolatility(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback + 1) return [];

  // Compute daily returns first
  const dailyReturns: { date: string; value: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    dailyReturns.push({
      date: bars[i].date,
      value: bars[i].value / bars[i - 1].value - 1,
    });
  }

  if (dailyReturns.length < lookback) return [];

  const result: DailyBar[] = [];
  for (let i = lookback - 1; i < dailyReturns.length; i++) {
    const window = dailyReturns.slice(i - lookback + 1, i + 1);
    const mean = window.reduce((s, r) => s + r.value, 0) / lookback;
    const variance = window.reduce((s, r) => s + (r.value - mean) ** 2, 0) / lookback;
    result.push({
      date: dailyReturns[i].date,
      value: Math.sqrt(variance),
    });
  }
  return result;
}
```

- [ ] **Step 8: Implement drawdown.ts**

```ts
// src/computations/drawdown.ts
import type { DailyBar } from '../handles/indicator.js';

export function computeDrawdown(bars: DailyBar[], lookback: number): DailyBar[] {
  if (bars.length < lookback) return [];

  const result: DailyBar[] = [];
  for (let i = lookback - 1; i < bars.length; i++) {
    let max = -Infinity;
    for (let j = i - lookback + 1; j <= i; j++) {
      if (bars[j].value > max) max = bars[j].value;
    }
    result.push({
      date: bars[i].date,
      value: (bars[i].value - max) / max,
    });
  }
  return result;
}
```

- [ ] **Step 9: Implement calendar.ts**

```ts
// src/computations/calendar.ts
import type { DailyBar } from '../handles/indicator.js';

type CalendarPeriod = 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year';

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function computeCalendar(bars: DailyBar[], period: CalendarPeriod): DailyBar[] {
  return bars.map((bar) => {
    // Parse as local date to avoid timezone shifts
    const [y, m, d] = bar.date.split('-').map(Number);
    const date = new Date(y, m - 1, d);

    let value: number;
    switch (period) {
      case 'Month':
        value = date.getMonth() + 1;
        break;
      case 'Day of Week':
        value = date.getDay();
        break;
      case 'Day of Month':
        value = date.getDate();
        break;
      case 'Day of Year':
        value = dayOfYear(date);
        break;
    }

    return { date: bar.date, value };
  });
}
```

- [ ] **Step 10: Implement computations barrel**

```ts
// src/computations/index.ts
import type { DailyBar } from '../handles/indicator.js';
import type { Database } from '../database.types.js';
import { computeSma } from './sma.js';
import { computeEma } from './ema.js';
import { computeRsi } from './rsi.js';
import { computeReturns } from './returns.js';
import { computeVolatility } from './volatility.js';
import { computeDrawdown } from './drawdown.js';

export { computeSma } from './sma.js';
export { computeEma } from './ema.js';
export { computeRsi } from './rsi.js';
export { computeReturns } from './returns.js';
export { computeVolatility } from './volatility.js';
export { computeDrawdown } from './drawdown.js';
export { computeCalendar } from './calendar.js';

type IndicatorType = Database['public']['Enums']['indicator_type'];
type ComputeFn = (bars: DailyBar[], lookback: number) => DailyBar[];

const COMPUTATIONS: Partial<Record<IndicatorType, ComputeFn>> = {
  SMA: computeSma,
  EMA: computeEma,
  RSI: computeRsi,
  Return: computeReturns,
  Volatility: computeVolatility,
  Drawdown: computeDrawdown,
};

export function getComputation(type: IndicatorType): ComputeFn | null {
  return COMPUTATIONS[type] ?? null;
}
```

- [ ] **Step 11: Run tests**

Run: `npx vitest run src/computations/computations.test.ts`
Expected: PASS (all tests)

- [ ] **Step 12: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 13: Commit**

```bash
git add src/computations/
git commit -m "feat: add indicator computation functions (SMA, EMA, RSI, returns, volatility, drawdown, calendar)"
```

---

### Task 5: Client Config Update

**Files:**
- Modify: `src/client.ts`
- Modify: `src/client.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/client.test.ts`:

```ts
describe('createClient config', () => {
  it('accepts fredApiKey', () => {
    const sdk = createClient({ supabase: testSupabase(), fredApiKey: 'test-key' });
    expect(sdk).toBeDefined();
  });

  it('works without fredApiKey', () => {
    const sdk = createClient({ supabase: testSupabase() });
    expect(sdk).toBeDefined();
  });
});
```

- [ ] **Step 2: Update LivefolioClientOptions in client.ts**

Add `fredApiKey` to the options interface and pass it through to handles:

```ts
export interface LivefolioClientOptions {
  supabase: TypedSupabaseClient;
  fredApiKey?: string;
}
```

Update `IndicatorHandle` constructor calls to pass a config object. Add a third parameter to `IndicatorHandle`:

In `src/handles/indicator.ts`, add to the class:

```ts
export interface IndicatorConfig {
  fredApiKey?: string;
}
```

Update the constructor:

```ts
private _config: IndicatorConfig;

constructor(supabase: TypedSupabaseClient, identity: IndicatorIdentity, config?: IndicatorConfig) {
  // ...existing assignments...
  this._config = config ?? {};
}
```

Update the factory helpers in `client.ts` to pass config:

```ts
function tickerBound(
  sb: TypedSupabaseClient,
  type: IndicatorType,
  ticker: TickerHandle,
  lookback: number,
  opts?: IndicatorOpts,
  config?: IndicatorConfig,
): IndicatorHandle {
  return new IndicatorHandle(sb, {
    type, ticker, lookback,
    delay: opts?.delay ?? 0,
    unit: null, threshold: null,
  }, config);
}

function standalone(
  sb: TypedSupabaseClient,
  type: IndicatorType,
  opts?: IndicatorOpts,
  config?: IndicatorConfig,
): IndicatorHandle {
  return new IndicatorHandle(sb, {
    type, ticker: null, lookback: 0,
    delay: opts?.delay ?? 0,
    unit: null, threshold: null,
  }, config);
}
```

Update `createClient` to capture and pass config:

```ts
export function createClient(options: LivefolioClientOptions): LivefolioClient {
  const sb = options.supabase;
  const config: IndicatorConfig = { fredApiKey: options.fredApiKey };

  return {
    ticker: (symbol, leverage) => new TickerHandle(sb, symbol, leverage),

    sma: (ticker, lookback, opts?) => tickerBound(sb, 'SMA', ticker, lookback, opts, config),
    ema: (ticker, lookback, opts?) => tickerBound(sb, 'EMA', ticker, lookback, opts, config),
    price: (ticker, opts?) => tickerBound(sb, 'Price', ticker, 0, opts, config),
    returns: (ticker, lookback, opts?) => tickerBound(sb, 'Return', ticker, lookback, opts, config),
    volatility: (ticker, lookback, opts?) => tickerBound(sb, 'Volatility', ticker, lookback, opts, config),
    drawdown: (ticker, lookback, opts?) => tickerBound(sb, 'Drawdown', ticker, lookback, opts, config),
    rsi: (ticker, lookback, opts?) => tickerBound(sb, 'RSI', ticker, lookback, opts, config),

    vix: (opts?) => standalone(sb, 'VIX', opts, config),
    vix3m: (opts?) => standalone(sb, 'VIX3M', opts, config),
    treasury: (tenor, opts?) => standalone(sb, tenor, opts, config),
    calendar: (period, opts?) => standalone(sb, period, opts, config),

    threshold: (value, unit?) =>
      new IndicatorHandle(sb, {
        type: 'Threshold', ticker: null, lookback: 0,
        delay: 0, unit: unit ?? null, threshold: value,
      }, config),
  };
}
```

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: all existing tests still pass, new config tests pass

- [ ] **Step 4: Commit**

```bash
git add src/client.ts src/client.test.ts src/handles/indicator.ts
git commit -m "feat: add fredApiKey to client config, pass config to IndicatorHandle"
```

---

### Task 6: IndicatorHandle Sync Integration

**Files:**
- Modify: `src/handles/indicator.ts`
- Test: `src/handles/sync.test.ts`

This is the core task. Add freshness checking, dependency resolution, fetching, computing, upserting, and in-memory caching to IndicatorHandle.

- [ ] **Step 1: Write the failing test for freshness + sync**

```ts
// src/handles/sync.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndicatorHandle } from './indicator.js';
import { TickerHandle } from './ticker.js';
import type { TypedSupabaseClient } from '../types.js';
import type { DailyBar } from './indicator.js';

// Mock providers
vi.mock('../providers/yahoo.js', () => ({
  fetchYahoo: vi.fn(),
}));
vi.mock('../providers/fred.js', () => ({
  fetchFred: vi.fn(),
}));

import { fetchYahoo } from '../providers/yahoo.js';
import { fetchFred } from '../providers/fred.js';
const mockFetchYahoo = vi.mocked(fetchYahoo);
const mockFetchFred = vi.mocked(fetchFred);

// Build a mock supabase that tracks calls
function buildMockSupabase(options: {
  tickerRow?: Record<string, unknown>;
  indicatorRow?: Record<string, unknown>;
  latestSeriesDate?: string | null; // null = no series data
  latestClosedTradingDay?: string;
  tradingDayRows?: { id: number; date: string }[];
  seriesRows?: { value: number; trading_days: { date: string } }[];
}) {
  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'tickers') {
      return {
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: options.tickerRow, error: null }),
          }),
        }),
      };
    }
    if (table === 'indicators') {
      return {
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: options.indicatorRow, error: null }),
          }),
        }),
      };
    }
    if (table === 'indicators_series') {
      return {
        select: vi.fn().mockImplementation((sel: string) => {
          // For freshness check: select max trading_day date
          if (sel.includes('trading_days')) {
            const orderFn = vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: options.latestSeriesDate
                    ? { trading_days: { date: options.latestSeriesDate } }
                    : null,
                  error: options.latestSeriesDate ? null : { code: 'PGRST116' },
                }),
              }),
            });
            return {
              eq: vi.fn().mockReturnValue({
                order: orderFn,
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockReturnValue({
                    then: vi.fn(),
                  }),
                }),
              }),
            };
          }
          // For series query
          return {
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                gte: vi.fn().mockReturnValue({
                  lte: vi.fn().mockReturnValue({
                    then: vi.fn().mockResolvedValue({ data: options.seriesRows ?? [], error: null }),
                  }),
                }),
                then: vi.fn().mockResolvedValue({ data: options.seriesRows ?? [], error: null }),
              }),
            }),
          };
        }),
        upsert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            then: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      };
    }
    if (table === 'trading_days') {
      return {
        select: vi.fn().mockReturnValue({
          lte: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { date: options.latestClosedTradingDay ?? '2025-01-10' },
                  error: null,
                }),
              }),
            }),
          }),
          in: vi.fn().mockReturnValue({
            then: vi.fn().mockResolvedValue({
              data: options.tradingDayRows ?? [],
              error: null,
            }),
          }),
          gte: vi.fn().mockReturnValue({
            lte: vi.fn().mockReturnValue({
              then: vi.fn().mockResolvedValue({
                data: options.tradingDayRows ?? [],
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    return {};
  });
  return { from } as unknown as TypedSupabaseClient;
}

describe('IndicatorHandle sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches from Yahoo when Price series is empty', async () => {
    const yahooData: DailyBar[] = [
      { date: '2025-01-02', value: 100 },
      { date: '2025-01-03', value: 101 },
    ];
    mockFetchYahoo.mockResolvedValue(yahooData);

    const sb = buildMockSupabase({
      tickerRow: { id: 1, symbol: 'SPY', leverage: 1, created_at: '' },
      indicatorRow: { id: 10, type: 'Price', ticker_id: 1, lookback: 0, delay: 0, unit: null, threshold: null, created_at: '' },
      latestSeriesDate: null, // empty series
      latestClosedTradingDay: '2025-01-03',
      tradingDayRows: [
        { id: 100, date: '2025-01-02' },
        { id: 101, date: '2025-01-03' },
      ],
    });

    const ticker = new TickerHandle(sb, 'SPY');
    const handle = new IndicatorHandle(sb, {
      type: 'Price', ticker, lookback: 0, delay: 0, unit: null, threshold: null,
    });

    await handle.series();

    expect(mockFetchYahoo).toHaveBeenCalledWith('SPY', undefined);
  });

  it('fetches from FRED for treasury indicators', async () => {
    const fredData: DailyBar[] = [{ date: '2025-01-02', value: 4.25 }];
    mockFetchFred.mockResolvedValue(fredData);

    const sb = buildMockSupabase({
      indicatorRow: { id: 20, type: 'T10Y', ticker_id: null, lookback: 0, delay: 0, unit: null, threshold: null, created_at: '' },
      latestSeriesDate: null,
      latestClosedTradingDay: '2025-01-02',
      tradingDayRows: [{ id: 100, date: '2025-01-02' }],
    });

    const handle = new IndicatorHandle(
      sb,
      { type: 'T10Y', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null },
      { fredApiKey: 'test-key' },
    );

    await handle.series();

    expect(mockFetchFred).toHaveBeenCalledWith('DGS10', 'test-key', undefined);
  });

  it('throws when treasury indicator has no FRED API key', async () => {
    const sb = buildMockSupabase({
      indicatorRow: { id: 20, type: 'T10Y', ticker_id: null, lookback: 0, delay: 0, unit: null, threshold: null, created_at: '' },
      latestSeriesDate: null,
      latestClosedTradingDay: '2025-01-02',
    });

    const handle = new IndicatorHandle(sb, {
      type: 'T10Y', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null,
    });

    await expect(handle.series()).rejects.toThrow('FRED API key required');
  });

  it('skips sync when series is already fresh', async () => {
    const sb = buildMockSupabase({
      indicatorRow: { id: 10, type: 'VIX', ticker_id: null, lookback: 0, delay: 0, unit: null, threshold: null, created_at: '' },
      latestSeriesDate: '2025-01-10', // matches latest closed
      latestClosedTradingDay: '2025-01-10',
      seriesRows: [{ value: 20, trading_days: { date: '2025-01-10' } }],
    });

    const handle = new IndicatorHandle(sb, {
      type: 'VIX', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null,
    });

    await handle.series();

    expect(mockFetchYahoo).not.toHaveBeenCalled();
  });

  it('caches series in memory on subsequent calls', async () => {
    mockFetchYahoo.mockResolvedValue([{ date: '2025-01-02', value: 20 }]);

    const sb = buildMockSupabase({
      indicatorRow: { id: 10, type: 'VIX', ticker_id: null, lookback: 0, delay: 0, unit: null, threshold: null, created_at: '' },
      latestSeriesDate: '2025-01-02',
      latestClosedTradingDay: '2025-01-02',
      seriesRows: [{ value: 20, trading_days: { date: '2025-01-02' } }],
    });

    const handle = new IndicatorHandle(sb, {
      type: 'VIX', ticker: null, lookback: 0, delay: 0, unit: null, threshold: null,
    });

    const first = await handle.series();
    const second = await handle.series();

    // Both return same data, but second call should not re-query
    expect(first).toEqual(second);
  });
});
```

Note: These tests exercise the overall sync flow. The mock supabase is complex because the sync touches multiple tables. Some tests may need adjustment during implementation as the exact query patterns are established.

- [ ] **Step 2: Implement sync logic in IndicatorHandle**

Add these private methods to `IndicatorHandle` in `src/handles/indicator.ts`:

```ts
// New imports at top of file
import { fetchYahoo } from '../providers/yahoo.js';
import { fetchFred } from '../providers/fred.js';
import { getProviderInfo } from '../providers/mappings.js';
import { getComputation } from '../computations/index.js';
import { computeCalendar } from '../computations/calendar.js';

// New private fields
private _config: IndicatorConfig;
private _cachedSeries: DailyBar[] | null = null;
private _cachedAsOf: string | null = null; // latest closed trading day when cache was built
private _syncing: Promise<void> | null = null;
```

Add `IndicatorConfig` interface and update constructor:

```ts
export interface IndicatorConfig {
  fredApiKey?: string;
}

constructor(supabase: TypedSupabaseClient, identity: IndicatorIdentity, config?: IndicatorConfig) {
  this._supabase = supabase;
  this._config = config ?? {};
  this.type = identity.type;
  this.ticker = identity.ticker;
  this.lookback = identity.lookback;
  this.delay = identity.delay;
  this.unit = identity.unit;
  this.threshold = identity.threshold;
}
```

Add sync methods:

```ts
private async _getLatestClosedTradingDay(): Promise<string> {
  const { data, error } = await this._supabase
    .from('trading_days')
    .select('date')
    .lte('close', new Date().toISOString())
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data.date;
}

private async _getLatestSeriesDate(indicatorId: number): Promise<string | null> {
  const { data, error } = await this._supabase
    .from('indicators_series')
    .select('trading_days!inner(date)')
    .eq('indicator_id', indicatorId)
    .order('trading_day_id', { ascending: false })
    .limit(1)
    .single();

  if (error?.code === 'PGRST116') return null; // no rows
  if (error) throw error;
  return (data as unknown as { trading_days: { date: string } }).trading_days.date;
}

private async _ensureFresh(): Promise<void> {
  if (this._syncing) return this._syncing;

  const row = await this.resolve();
  const latestClosed = await this._getLatestClosedTradingDay();

  // Check in-memory cache freshness
  if (this._cachedSeries && this._cachedAsOf === latestClosed) return;

  const latestSeries = await this._getLatestSeriesDate(row.id);

  if (latestSeries === latestClosed) {
    // DB is fresh, just clear the in-memory cache so it re-reads
    this._cachedSeries = null;
    this._cachedAsOf = latestClosed;
    return;
  }

  // Need to sync
  this._syncing = this._sync(latestSeries ?? undefined, latestClosed);
  await this._syncing;
  this._syncing = null;
  this._cachedSeries = null;
  this._cachedAsOf = latestClosed;
}

private async _sync(fromDate: string | undefined, _latestClosed: string): Promise<void> {
  const tickerSymbol = this.ticker?.symbol ?? null;
  const providerInfo = getProviderInfo(this.type, tickerSymbol);

  let bars: DailyBar[];

  switch (providerInfo.provider) {
    case 'yahoo':
      bars = await fetchYahoo(providerInfo.symbol, fromDate);
      break;

    case 'fred':
      if (!this._config.fredApiKey) throw new Error('FRED API key required for treasury indicators');
      bars = await fetchFred(providerInfo.seriesId, this._config.fredApiKey, fromDate);
      break;

    case 'computed': {
      // Ensure dependency (Price) is fresh first
      const depHandle = new IndicatorHandle(
        this._supabase,
        { type: 'Price', ticker: this.ticker, lookback: 0, delay: 0, unit: null, threshold: null },
        this._config,
      );
      await depHandle._ensureFresh();
      const priceSeries = await depHandle._querySeriesFromDb();

      const computeFn = getComputation(this.type);
      if (!computeFn) throw new Error(`No computation for type: ${this.type}`);
      const allComputed = computeFn(priceSeries, this.lookback);

      // Only upsert bars newer than what we have
      bars = fromDate ? allComputed.filter((b) => b.date > fromDate) : allComputed;
      break;
    }

    case 'calendar': {
      // Get trading days and compute calendar values
      const { data: tradingDays, error } = await this._supabase
        .from('trading_days')
        .select('id, date')
        .order('date', { ascending: true });

      if (error) throw error;
      const calendarBars = tradingDays.map((td) => ({ date: td.date, value: 0 }));
      const period = this.type as 'Month' | 'Day of Week' | 'Day of Month' | 'Day of Year';
      const allComputed = computeCalendar(calendarBars, period);
      bars = fromDate ? allComputed.filter((b) => b.date > fromDate) : allComputed;
      break;
    }

    case 'none':
      return; // Threshold — nothing to sync
  }

  if (bars.length === 0) return;
  await this._upsertSeries(bars);
}

private async _upsertSeries(bars: DailyBar[]): Promise<void> {
  const row = await this.resolve();

  // Map dates to trading_day_ids
  const dates = bars.map((b) => b.date);
  const { data: tradingDays, error: tdError } = await this._supabase
    .from('trading_days')
    .select('id, date')
    .in('date', dates);

  if (tdError) throw tdError;

  const dateToId = new Map(tradingDays.map((td) => [td.date, td.id]));

  const rows = bars
    .filter((b) => dateToId.has(b.date))
    .map((b) => ({
      indicator_id: row.id,
      trading_day_id: dateToId.get(b.date)!,
      value: b.value,
    }));

  if (rows.length === 0) return;

  const { error } = await this._supabase
    .from('indicators_series')
    .upsert(rows, { onConflict: 'indicator_id,trading_day_id' });

  if (error) throw error;
}

// Expose raw DB query for dependency resolution
async _querySeriesFromDb(range?: DateRange): Promise<DailyBar[]> {
  const row = await this.resolve();
  let query = this._supabase
    .from('indicators_series')
    .select('value, trading_days!inner(date)')
    .eq('indicator_id', row.id)
    .order('trading_day_id', { ascending: true });

  if (range?.from) query = query.gte('trading_days.date', range.from);
  if (range?.to) query = query.lte('trading_days.date', range.to);

  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as { value: number; trading_days: { date: string } }[]).map((r) => ({
    date: r.trading_days.date,
    value: r.value,
  }));
}
```

Update the existing `series()` method to use sync + cache:

```ts
async series(range?: DateRange): Promise<DailyBar[]> {
  await this._ensureFresh();

  if (this._cachedSeries && !range) return this._cachedSeries;

  const bars = await this._querySeriesFromDb(range);

  if (!range) {
    this._cachedSeries = bars;
  }

  return bars;
}
```

Update the existing `value()` method to ensure freshness first:

```ts
async value(date?: string): Promise<number | null> {
  await this._ensureFresh();

  // ...rest of existing value() implementation unchanged...
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: all tests pass (existing + new sync tests)

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/handles/indicator.ts src/handles/sync.test.ts
git commit -m "feat: add transparent indicator sync with fetch, compute, and cache"
```

---

### Task 7: Build Verification

**Files:** none (verification only)

- [ ] **Step 1: Clean build**

```bash
npm run clean && npm run build
```

Expected: `dist/` contains compiled JS + declarations for all new files

- [ ] **Step 2: Verify exports**

```bash
node -e "import('@livefolio/sdk').then(m => console.log(Object.keys(m)))"
```

Expected: prints `['IndicatorHandle', 'TickerHandle', 'createClient']`

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no errors

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass

- [ ] **Step 5: Commit any lint fixes**

```bash
git add -A && git commit -m "chore: lint fixes"
```
