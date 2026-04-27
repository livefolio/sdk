# Simulation Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `src/metrics/` module that turns a `SimulationHandle` into a structured `MetricsResult` (returns / risk / risk-adjusted / activity / tables). Hand-written TypeScript, zero new runtime dependencies, fully synchronous.

**Architecture:** One file per metric category, plus an orchestrator (`compute.ts`) that combines them. `SimulationHandle.metrics()` is a thin adapter that calls the orchestrator with `this.series` and `this.trades`. Free helpers exported from `src/metrics/index.ts` for callers without a simulation.

**Tech Stack:** TypeScript (strict mode), Vitest, tsup. No new runtime deps.

**Spec:** `docs/specs/2026-04-26-simulation-metrics-design.md`

**Conventions reminder:**
- Extensionless ESM imports (`import { Foo } from './foo'`).
- Co-located `*.test.ts` files. Run with `npm test`.
- `DailyBar` type lives at `src/handles/indicator.ts` (`{ date: string; value: number }`).
- `Trade` type lives at `src/backtest/types.ts` (`{ date, symbol, quantity, price, action }`).

---

## Task 1: Types + module skeleton

**Goal:** Set up `src/metrics/` with types, an empty `compute.ts` stub, and a barrel export. No math yet — locks the public API shape.

**Files:**
- Create: `src/metrics/types.ts`
- Create: `src/metrics/compute.ts`
- Create: `src/metrics/index.ts`
- Create: `src/metrics/types.test.ts`

**Acceptance Criteria:**
- [ ] `MetricsOptions`, `MetricsResult`, `DrawdownEntry`, `MonthlyReturnsTable` exported from `src/metrics/index.ts`.
- [ ] `computeMetrics` exported and callable, throws `Error('metrics requires at least 2 daily bars')` for short input.
- [ ] `npm run lint` clean. `npm test -- src/metrics` passes.

**Verify:** `npm test -- src/metrics/types.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/metrics/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeMetrics } from './index';

describe('computeMetrics (skeleton)', () => {
  it('throws when given fewer than 2 bars', () => {
    expect(() => computeMetrics([], [])).toThrow(/at least 2 daily bars/);
    expect(() => computeMetrics([{ date: '2024-01-02', value: 100 }], [])).toThrow(/at least 2 daily bars/);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test -- src/metrics/types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/metrics/types.ts`**

```ts
export interface MetricsOptions {
  riskFreeRate?: number;
  topDrawdowns?: number;
  varConfidence?: number;
}

export interface DrawdownEntry {
  peakDate: string;
  troughDate: string;
  recoveryDate: string | null;
  depth: number;
  durationDays: number;
  underwaterDays: number;
}

export interface MonthlyReturnsTable {
  rows: Array<{ year: number; months: (number | null)[]; ytd: number | null }>;
}

export interface MetricsResult {
  range: { from: string; to: string; years: number };
  returns: {
    totalReturn: number;
    cagr: number;
    bestYear: { year: number; return: number } | null;
    worstYear: { year: number; return: number } | null;
    bestMonth: { date: string; return: number } | null;
    worstMonth: { date: string; return: number } | null;
    pctPositiveMonths: number;
  };
  risk: {
    volatility: number;
    downsideDeviation: number;
    maxDrawdown: DrawdownEntry;
    currentDrawdown: number;
    ulcerIndex: number;
    skew: number;
    kurtosis: number;
    var95: number;
    cvar95: number;
  };
  riskAdjusted: { sharpe: number; sortino: number; calmar: number };
  activity: { rebalances: number; trades: number; turnover: number; winRate: number };
  tables: {
    drawdowns: DrawdownEntry[];
    monthly: MonthlyReturnsTable;
    yearly: Array<{ year: number; return: number }>;
  };
}
```

- [ ] **Step 4: Create `src/metrics/compute.ts` stub**

```ts
import type { DailyBar } from '../handles/indicator';
import type { Trade } from '../backtest/types';
import type { MetricsOptions, MetricsResult } from './types';

export function computeMetrics(
  series: DailyBar[],
  _trades: Trade[],
  _options: MetricsOptions = {},
): MetricsResult {
  if (series.length < 2) {
    throw new Error('metrics requires at least 2 daily bars');
  }
  throw new Error('not implemented');
}
```

- [ ] **Step 5: Create `src/metrics/index.ts` barrel**

```ts
export type {
  MetricsOptions,
  MetricsResult,
  DrawdownEntry,
  MonthlyReturnsTable,
} from './types';
export { computeMetrics } from './compute';
```

- [ ] **Step 6: Run test, expect pass**

Run: `npm test -- src/metrics/types.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/metrics/
git commit -m "feat(metrics): module skeleton + types"
```

---

## Task 2: returns.ts — daily, monthly, yearly returns

**Goal:** Pure helpers that turn a `DailyBar[]` into return arrays and period-bucketed return arrays.

**Files:**
- Create: `src/metrics/returns.ts`
- Create: `src/metrics/returns.test.ts`

**Acceptance Criteria:**
- [ ] `dailyReturns(series)` returns `length-1` array of `(NAV_t / NAV_{t-1}) - 1`.
- [ ] `monthlyReturns(series)` returns `Array<{ year, month, return, partial }>` where `partial` is `true` for the first or last bucket if it doesn't span a full calendar month.
- [ ] `yearlyReturns(series)` returns `Array<{ year, return, partial }>`.
- [ ] All three handle the 2-bar minimum series correctly.

**Verify:** `npm test -- src/metrics/returns.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write tests**

Create `src/metrics/returns.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dailyReturns, monthlyReturns, yearlyReturns } from './returns';
import type { DailyBar } from '../handles/indicator';

const bars = (entries: Array<[string, number]>): DailyBar[] =>
  entries.map(([date, value]) => ({ date, value }));

describe('dailyReturns', () => {
  it('returns N-1 returns for N bars', () => {
    const r = dailyReturns(bars([['2024-01-02', 100], ['2024-01-03', 110], ['2024-01-04', 99]]));
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
  });
});

describe('monthlyReturns', () => {
  it('produces one entry per month spanned, marking partial first/last', () => {
    const r = monthlyReturns(bars([
      ['2024-01-15', 100],
      ['2024-01-31', 110],
      ['2024-02-29', 121],
      ['2024-03-15', 130],
    ]));
    // First month partial (starts mid-Jan), Feb full, March partial.
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ year: 2024, month: 0, return: 0.1, partial: true });
    expect(r[1]!.partial).toBe(false);
    expect(r[1]!.return).toBeCloseTo(0.1, 10);
    expect(r[2]!.partial).toBe(true);
  });

  it('single full month returns one non-partial entry', () => {
    const r = monthlyReturns(bars([['2024-01-01', 100], ['2024-01-31', 105]]));
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ year: 2024, month: 0, return: 0.05, partial: false });
  });
});

describe('yearlyReturns', () => {
  it('marks first/last year partial when not full-year span', () => {
    const r = yearlyReturns(bars([
      ['2023-06-01', 100],
      ['2023-12-29', 110],
      ['2024-12-31', 121],
      ['2025-03-15', 130],
    ]));
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ year: 2023, return: 0.1, partial: true });
    expect(r[1]).toEqual({ year: 2024, return: 0.1, partial: false });
    expect(r[2]!.partial).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `npm test -- src/metrics/returns.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/metrics/returns.ts`**

```ts
import type { DailyBar } from '../handles/indicator';

export interface MonthlyReturn {
  year: number;
  month: number; // 0..11
  return: number;
  partial: boolean;
}

export interface YearlyReturn {
  year: number;
  return: number;
  partial: boolean;
}

export function dailyReturns(series: DailyBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!.value;
    const curr = series[i]!.value;
    out.push(curr / prev - 1);
  }
  return out;
}

function ymd(date: string): { y: number; m: number; d: number } {
  return {
    y: Number(date.slice(0, 4)),
    m: Number(date.slice(5, 7)) - 1,
    d: Number(date.slice(8, 10)),
  };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function monthlyReturns(series: DailyBar[]): MonthlyReturn[] {
  if (series.length < 2) return [];

  // Bucket bars by (year, month) — keep first and last NAV in each bucket.
  type Bucket = { year: number; month: number; firstDate: string; firstValue: number; lastDate: string; lastValue: number };
  const buckets: Bucket[] = [];
  for (const bar of series) {
    const { y, m } = ymd(bar.date);
    const last = buckets[buckets.length - 1];
    if (!last || last.year !== y || last.month !== m) {
      buckets.push({ year: y, month: m, firstDate: bar.date, firstValue: bar.value, lastDate: bar.date, lastValue: bar.value });
    } else {
      last.lastDate = bar.date;
      last.lastValue = bar.value;
    }
  }

  // Walk consecutive buckets; first bucket compares last-of-month to first NAV in that bucket.
  const out: MonthlyReturn[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    const prevLast = i === 0 ? b.firstValue : buckets[i - 1]!.lastValue;
    const ret = b.lastValue / prevLast - 1;
    const startsAtMonthStart = ymd(b.firstDate).d === 1;
    const endsAtMonthEnd = ymd(b.lastDate).d === lastDayOfMonth(b.year, b.month);
    const isFirst = i === 0;
    const isLast = i === buckets.length - 1;
    const partial = (isFirst && !startsAtMonthStart) || (isLast && !endsAtMonthEnd);
    out.push({ year: b.year, month: b.month, return: ret, partial });
  }
  return out;
}

export function yearlyReturns(series: DailyBar[]): YearlyReturn[] {
  if (series.length < 2) return [];

  type Bucket = { year: number; firstDate: string; firstValue: number; lastDate: string; lastValue: number };
  const buckets: Bucket[] = [];
  for (const bar of series) {
    const { y } = ymd(bar.date);
    const last = buckets[buckets.length - 1];
    if (!last || last.year !== y) {
      buckets.push({ year: y, firstDate: bar.date, firstValue: bar.value, lastDate: bar.date, lastValue: bar.value });
    } else {
      last.lastDate = bar.date;
      last.lastValue = bar.value;
    }
  }

  const out: YearlyReturn[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]!;
    const prevLast = i === 0 ? b.firstValue : buckets[i - 1]!.lastValue;
    const ret = b.lastValue / prevLast - 1;
    const isFirst = i === 0;
    const isLast = i === buckets.length - 1;
    const startsAtYearStart = b.firstDate.endsWith('-01-01');
    const endsAtYearEnd = b.lastDate.endsWith('-12-31');
    const partial = (isFirst && !startsAtYearStart) || (isLast && !endsAtYearEnd);
    out.push({ year: b.year, return: ret, partial });
  }
  return out;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test -- src/metrics/returns.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/metrics/returns.ts src/metrics/returns.test.ts
git commit -m "feat(metrics): daily/monthly/yearly return helpers"
```

---

## Task 3: summary.ts — total return, CAGR, best/worst, %positive

**Goal:** Period-summary helpers using `returns.ts`.

**Files:**
- Create: `src/metrics/summary.ts`
- Create: `src/metrics/summary.test.ts`

**Acceptance Criteria:**
- [ ] `totalReturn(series)` = `last/first - 1`.
- [ ] `cagr(series)` uses `(last/first)^(1/years) - 1` where `years = (lastUTC - firstUTC) / 365.25 days`.
- [ ] `bestYear` / `worstYear` filter out `partial` years.
- [ ] `bestMonth` / `worstMonth` filter out `partial` months. Returns `'YYYY-MM'` for the date.
- [ ] `pctPositiveMonths` denominator excludes partial months.
- [ ] All return `null` when no eligible buckets exist.

**Verify:** `npm test -- src/metrics/summary.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write tests**

Create `src/metrics/summary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { totalReturn, cagr, bestYear, worstYear, bestMonth, worstMonth, pctPositiveMonths } from './summary';
import { yearlyReturns, monthlyReturns } from './returns';
import type { DailyBar } from '../handles/indicator';

const bars = (entries: Array<[string, number]>): DailyBar[] =>
  entries.map(([date, value]) => ({ date, value }));

describe('totalReturn / cagr', () => {
  it('totalReturn = last/first - 1', () => {
    expect(totalReturn(bars([['2024-01-01', 100], ['2024-12-31', 121]]))).toBeCloseTo(0.21, 10);
  });

  it('cagr scales by fractional years', () => {
    const s = bars([['2023-01-01', 100], ['2025-01-01', 121]]);
    // years = ~2 → cagr ~ 0.1
    expect(cagr(s)).toBeCloseTo(0.1, 4);
  });
});

describe('best/worst year & month', () => {
  it('best/worstYear ignore partial years', () => {
    const s = bars([
      ['2023-06-01', 100], // partial 2023
      ['2023-12-29', 90],
      ['2024-12-31', 108], // full 2024 = +20%
      ['2025-03-15', 130], // partial 2025
    ]);
    const yr = yearlyReturns(s);
    expect(bestYear(yr)).toEqual({ year: 2024, return: 0.2 });
    expect(worstYear(yr)).toEqual({ year: 2024, return: 0.2 });
  });

  it('best/worstMonth ignore partial months', () => {
    const s = bars([
      ['2024-01-15', 100],         // partial Jan
      ['2024-01-31', 105],
      ['2024-02-29', 100],         // full Feb = -4.76%
      ['2024-03-31', 110],         // full March = +10%
    ]);
    const mr = monthlyReturns(s);
    expect(bestMonth(mr)?.date).toBe('2024-03');
    expect(worstMonth(mr)?.date).toBe('2024-02');
  });
});

describe('pctPositiveMonths', () => {
  it('counts only full months', () => {
    const s = bars([
      ['2024-01-15', 100],         // partial → skipped
      ['2024-01-31', 110],
      ['2024-02-29', 105],         // full, negative
      ['2024-03-31', 116],         // full, positive
    ]);
    const mr = monthlyReturns(s);
    expect(pctPositiveMonths(mr)).toBeCloseTo(0.5, 10);
  });

  it('returns 0 when no full months exist', () => {
    const s = bars([['2024-01-15', 100], ['2024-01-20', 110]]);
    const mr = monthlyReturns(s);
    expect(pctPositiveMonths(mr)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement `src/metrics/summary.ts`**

```ts
import type { DailyBar } from '../handles/indicator';
import type { MonthlyReturn, YearlyReturn } from './returns';

const DAY_MS = 24 * 60 * 60 * 1000;

function dateUTC(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

export function totalReturn(series: DailyBar[]): number {
  return series[series.length - 1]!.value / series[0]!.value - 1;
}

export function years(series: DailyBar[]): number {
  const first = dateUTC(series[0]!.date);
  const last = dateUTC(series[series.length - 1]!.date);
  return (last - first) / DAY_MS / 365.25;
}

export function cagr(series: DailyBar[]): number {
  const y = years(series);
  if (y <= 0) return 0;
  const ratio = series[series.length - 1]!.value / series[0]!.value;
  return Math.pow(ratio, 1 / y) - 1;
}

export function bestYear(yr: YearlyReturn[]): { year: number; return: number } | null {
  let best: YearlyReturn | null = null;
  for (const y of yr) {
    if (y.partial) continue;
    if (!best || y.return > best.return) best = y;
  }
  return best ? { year: best.year, return: best.return } : null;
}

export function worstYear(yr: YearlyReturn[]): { year: number; return: number } | null {
  let worst: YearlyReturn | null = null;
  for (const y of yr) {
    if (y.partial) continue;
    if (!worst || y.return < worst.return) worst = y;
  }
  return worst ? { year: worst.year, return: worst.return } : null;
}

function monthKey(m: MonthlyReturn): string {
  return `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
}

export function bestMonth(mr: MonthlyReturn[]): { date: string; return: number } | null {
  let best: MonthlyReturn | null = null;
  for (const m of mr) {
    if (m.partial) continue;
    if (!best || m.return > best.return) best = m;
  }
  return best ? { date: monthKey(best), return: best.return } : null;
}

export function worstMonth(mr: MonthlyReturn[]): { date: string; return: number } | null {
  let worst: MonthlyReturn | null = null;
  for (const m of mr) {
    if (m.partial) continue;
    if (!worst || m.return < worst.return) worst = m;
  }
  return worst ? { date: monthKey(worst), return: worst.return } : null;
}

export function pctPositiveMonths(mr: MonthlyReturn[]): number {
  let total = 0;
  let pos = 0;
  for (const m of mr) {
    if (m.partial) continue;
    total++;
    if (m.return > 0) pos++;
  }
  return total === 0 ? 0 : pos / total;
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/metrics/summary.ts src/metrics/summary.test.ts
git commit -m "feat(metrics): total return, CAGR, best/worst, %positive"
```

---

## Task 4: risk.ts — vol, downside dev, skew, kurtosis, VaR, CVaR, Ulcer

**Goal:** Daily-return-based scalar risk stats. Pure functions over `number[]`. Annualization at the boundary.

**Files:**
- Create: `src/metrics/risk.ts`
- Create: `src/metrics/risk.test.ts`

**Acceptance Criteria:**
- [ ] `mean(r)`, `stdev(r)` (sample, divide by n-1).
- [ ] `volatility(r)` = `stdev(r) * sqrt(252)`.
- [ ] `downsideDeviation(r, marDaily)` = `sqrt(mean(min(0, r-mar)^2)) * sqrt(252)`.
- [ ] `skewness(r)` Fisher-Pearson sample with `n/((n-1)(n-2))` correction.
- [ ] `excessKurtosis(r)` sample with standard correction.
- [ ] `historicalVar(r, confidence)` returns positive loss magnitude.
- [ ] `historicalCvar(r, confidence)` returns positive loss magnitude.
- [ ] `ulcerIndex(series)` operates on NAV bars, not returns; returned in percent units.

**Verify:** `npm test -- src/metrics/risk.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write tests**

Create `src/metrics/risk.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  mean, stdev, volatility, downsideDeviation, skewness, excessKurtosis,
  historicalVar, historicalCvar, ulcerIndex,
} from './risk';
import type { DailyBar } from '../handles/indicator';

describe('mean / stdev', () => {
  it('mean of [1,2,3,4,5] = 3', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });
  it('sample stdev of [2,4,4,4,5,5,7,9] ≈ 2', () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 10);
  });
});

describe('volatility', () => {
  it('annualizes daily stdev by sqrt(252)', () => {
    const r = [0.01, -0.01, 0.02, -0.02, 0, 0.01, -0.01];
    expect(volatility(r)).toBeCloseTo(stdev(r) * Math.sqrt(252), 10);
  });
});

describe('downsideDeviation', () => {
  it('only negative deviations from MAR contribute', () => {
    // r=[-0.02, 0.01, -0.03, 0.05], MAR=0
    // down = [-0.02, 0, -0.03, 0]; mean(squared) = (0.0004 + 0 + 0.0009 + 0)/4 = 0.000325
    // sqrt(0.000325) * sqrt(252)
    const r = [-0.02, 0.01, -0.03, 0.05];
    expect(downsideDeviation(r, 0)).toBeCloseTo(Math.sqrt(0.000325) * Math.sqrt(252), 10);
  });
});

describe('skewness / excessKurtosis', () => {
  it('symmetric data has near-zero skew', () => {
    expect(Math.abs(skewness([-2, -1, 0, 1, 2]))).toBeLessThan(1e-10);
  });
  it('excess kurtosis of normal-ish symmetric ≈ low', () => {
    // Just sanity-check it runs and gives a finite number.
    expect(Number.isFinite(excessKurtosis([-2, -1, 0, 1, 2, -1, 1, 0, 0]))).toBe(true);
  });
});

describe('historicalVar / Cvar', () => {
  it('VaR95 on 20 sorted returns picks the right tail quantile as positive loss', () => {
    const r = [-0.1, -0.08, -0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02,
               0.02, 0.03, 0.03, 0.04, 0.04, 0.05, 0.05, 0.06, 0.06, 0.07];
    // 5th percentile is around -0.08-ish; VaR is positive magnitude.
    expect(historicalVar(r, 0.95)).toBeGreaterThan(0);
    expect(historicalCvar(r, 0.95)).toBeGreaterThanOrEqual(historicalVar(r, 0.95));
  });
});

describe('ulcerIndex', () => {
  it('returns 0 for monotonically increasing series', () => {
    const s: DailyBar[] = [
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 101 },
      { date: '2024-01-04', value: 102 },
    ];
    expect(ulcerIndex(s)).toBeCloseTo(0, 10);
  });
  it('non-zero for series with drawdown', () => {
    const s: DailyBar[] = [
      { date: '2024-01-02', value: 100 },
      { date: '2024-01-03', value: 90 },
      { date: '2024-01-04', value: 100 },
    ];
    // drawdowns in pct: 0, -10, 0; mean(squared) = (0+100+0)/3; sqrt ≈ 5.77
    expect(ulcerIndex(s)).toBeCloseTo(Math.sqrt(100 / 3), 6);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement `src/metrics/risk.ts`**

```ts
import type { DailyBar } from '../handles/indicator';

const TRADING_DAYS = 252;

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) {
    const d = x - m;
    s += d * d;
  }
  return Math.sqrt(s / (xs.length - 1));
}

export function volatility(returns: number[]): number {
  return stdev(returns) * Math.sqrt(TRADING_DAYS);
}

export function downsideDeviation(returns: number[], marDaily: number): number {
  if (returns.length === 0) return 0;
  let s = 0;
  for (const r of returns) {
    const d = Math.min(0, r - marDaily);
    s += d * d;
  }
  return Math.sqrt(s / returns.length) * Math.sqrt(TRADING_DAYS);
}

export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return 0;
  let sum = 0;
  for (const x of xs) {
    const z = (x - m) / s;
    sum += z * z * z;
  }
  return (n / ((n - 1) * (n - 2))) * sum;
}

export function excessKurtosis(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return 0;
  const m = mean(xs);
  const s = stdev(xs);
  if (s === 0) return 0;
  let sum = 0;
  for (const x of xs) {
    const z = (x - m) / s;
    sum += z * z * z * z;
  }
  const term1 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const term2 = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  return term1 * sum - term2;
}

function quantile(sortedAsc: number[], p: number): number {
  // Linear interpolation; p in [0,1].
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = p * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

export function historicalVar(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const q = quantile(sorted, 1 - confidence);
  return Math.max(0, -q);
}

export function historicalCvar(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const q = quantile(sorted, 1 - confidence);
  const tail = sorted.filter((r) => r <= q);
  if (tail.length === 0) return 0;
  return Math.max(0, -mean(tail));
}

export function ulcerIndex(series: DailyBar[]): number {
  if (series.length === 0) return 0;
  let runningMax = -Infinity;
  let sumSq = 0;
  for (const bar of series) {
    if (bar.value > runningMax) runningMax = bar.value;
    const ddPct = ((bar.value - runningMax) / runningMax) * 100;
    sumSq += ddPct * ddPct;
  }
  return Math.sqrt(sumSq / series.length);
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/metrics/risk.ts src/metrics/risk.test.ts
git commit -m "feat(metrics): scalar risk stats (vol, downside, skew, kurtosis, VaR, CVaR, Ulcer)"
```

---

## Task 5: drawdown.ts — max DD, current DD, top-N table

**Goal:** Drawdown table from a NAV series.

**Files:**
- Create: `src/metrics/drawdown.ts`
- Create: `src/metrics/drawdown.test.ts`

**Acceptance Criteria:**
- [ ] `computeDrawdownTable(series, topN)` returns up to `topN` `DrawdownEntry`s sorted by `|depth|` descending.
- [ ] Ongoing drawdown at series end has `recoveryDate: null` and `durationDays = lastDate - peakDate`.
- [ ] Recovered drawdowns have `durationDays = recoveryDate - peakDate`.
- [ ] Drawdowns with `|depth| < 1e-4` are filtered out.
- [ ] `currentDrawdown(series)` returns `(NAV_end / runningMax_end) - 1` (≤ 0).

**Verify:** `npm test -- src/metrics/drawdown.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write tests**

Create `src/metrics/drawdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeDrawdownTable, currentDrawdown } from './drawdown';
import type { DailyBar } from '../handles/indicator';

const bars = (entries: Array<[string, number]>): DailyBar[] =>
  entries.map(([date, value]) => ({ date, value }));

describe('computeDrawdownTable', () => {
  it('captures a recovered DD with correct peak/trough/recovery', () => {
    // Peak 2024-01-01 @100, trough 2024-01-05 @80 (-20%), recover 2024-01-10 @100.
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-03', 90],
      ['2024-01-05', 80],
      ['2024-01-08', 95],
      ['2024-01-10', 100],
      ['2024-01-15', 110], // new high after recovery
    ]);
    const dd = computeDrawdownTable(s, 5);
    expect(dd).toHaveLength(1);
    expect(dd[0]!.peakDate).toBe('2024-01-01');
    expect(dd[0]!.troughDate).toBe('2024-01-05');
    expect(dd[0]!.recoveryDate).toBe('2024-01-10');
    expect(dd[0]!.depth).toBeCloseTo(-0.2, 10);
    expect(dd[0]!.durationDays).toBe(9);
    expect(dd[0]!.underwaterDays).toBe(4);
  });

  it('records ongoing DD with recoveryDate=null', () => {
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-05', 90],
      ['2024-01-10', 85], // still underwater at series end
    ]);
    const dd = computeDrawdownTable(s, 5);
    expect(dd).toHaveLength(1);
    expect(dd[0]!.recoveryDate).toBeNull();
    expect(dd[0]!.peakDate).toBe('2024-01-01');
    expect(dd[0]!.troughDate).toBe('2024-01-10');
    expect(dd[0]!.durationDays).toBe(9);
  });

  it('returns top N sorted by depth', () => {
    // Two drawdowns: -20% then -10%
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-05', 80],
      ['2024-01-10', 100],
      ['2024-01-12', 90],
      ['2024-01-15', 100],
    ]);
    const dd = computeDrawdownTable(s, 5);
    expect(dd).toHaveLength(2);
    expect(dd[0]!.depth).toBeCloseTo(-0.2, 10);
    expect(dd[1]!.depth).toBeCloseTo(-0.1, 10);
  });

  it('topN truncates', () => {
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-02', 95],
      ['2024-01-03', 100],
      ['2024-01-04', 90],
      ['2024-01-05', 100],
      ['2024-01-06', 80],
      ['2024-01-07', 100],
    ]);
    expect(computeDrawdownTable(s, 1)).toHaveLength(1);
    expect(computeDrawdownTable(s, 2)).toHaveLength(2);
  });

  it('filters out near-zero drawdowns', () => {
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-02', 99.999],
      ['2024-01-03', 100],
    ]);
    expect(computeDrawdownTable(s, 5)).toHaveLength(0);
  });
});

describe('currentDrawdown', () => {
  it('returns 0 when at all-time high', () => {
    const s = bars([['2024-01-01', 100], ['2024-01-02', 110]]);
    expect(currentDrawdown(s)).toBeCloseTo(0, 10);
  });

  it('returns negative pct when underwater', () => {
    const s = bars([['2024-01-01', 100], ['2024-01-02', 110], ['2024-01-03', 99]]);
    expect(currentDrawdown(s)).toBeCloseTo(-0.1, 10);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement `src/metrics/drawdown.ts`**

```ts
import type { DailyBar } from '../handles/indicator';
import type { DrawdownEntry } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOISE = 1e-4;

function dateUTC(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function daysBetween(a: string, b: string): number {
  return Math.round((dateUTC(b) - dateUTC(a)) / DAY_MS);
}

export function computeDrawdownTable(series: DailyBar[], topN: number): DrawdownEntry[] {
  if (series.length === 0) return [];

  type Open = { peakDate: string; peakValue: number; troughDate: string; troughValue: number };
  const segments: DrawdownEntry[] = [];
  let peakDate = series[0]!.date;
  let peakValue = series[0]!.value;
  let open: Open | null = null;

  for (let i = 0; i < series.length; i++) {
    const bar = series[i]!;
    if (bar.value >= peakValue) {
      if (open) {
        // Recovery point.
        const recoveryDate = bar.date;
        const depth = open.troughValue / open.peakValue - 1;
        if (Math.abs(depth) >= NOISE) {
          segments.push({
            peakDate: open.peakDate,
            troughDate: open.troughDate,
            recoveryDate,
            depth,
            durationDays: daysBetween(open.peakDate, recoveryDate),
            underwaterDays: daysBetween(open.peakDate, open.troughDate),
          });
        }
        open = null;
      }
      peakDate = bar.date;
      peakValue = bar.value;
    } else {
      if (!open || bar.value < open.troughValue) {
        if (!open) {
          open = { peakDate, peakValue, troughDate: bar.date, troughValue: bar.value };
        } else {
          open.troughDate = bar.date;
          open.troughValue = bar.value;
        }
      }
    }
  }

  if (open) {
    const lastDate = series[series.length - 1]!.date;
    const depth = open.troughValue / open.peakValue - 1;
    if (Math.abs(depth) >= NOISE) {
      segments.push({
        peakDate: open.peakDate,
        troughDate: open.troughDate,
        recoveryDate: null,
        depth,
        durationDays: daysBetween(open.peakDate, lastDate),
        underwaterDays: daysBetween(open.peakDate, open.troughDate),
      });
    }
  }

  segments.sort((a, b) => Math.abs(b.depth) - Math.abs(a.depth));
  return segments.slice(0, topN);
}

export function currentDrawdown(series: DailyBar[]): number {
  if (series.length === 0) return 0;
  let runningMax = -Infinity;
  for (const bar of series) {
    if (bar.value > runningMax) runningMax = bar.value;
  }
  const last = series[series.length - 1]!.value;
  return last / runningMax - 1;
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/metrics/drawdown.ts src/metrics/drawdown.test.ts
git commit -m "feat(metrics): drawdown table + current drawdown"
```

---

## Task 6: riskAdjusted.ts — Sharpe, Sortino, Calmar

**Goal:** Risk-adjusted ratios. Daily-rate conversion of the annualized risk-free rate happens here.

**Files:**
- Create: `src/metrics/riskAdjusted.ts`
- Create: `src/metrics/riskAdjusted.test.ts`

**Acceptance Criteria:**
- [ ] `dailyRiskFree(annual)` = `(1 + annual)^(1/252) - 1`.
- [ ] `sharpe(returns, rfAnnual)` = `(mean - rfDaily) / stdev * sqrt(252)`. `NaN` when stdev = 0.
- [ ] `sortino(returns, rfAnnual)` numerator = `(mean - rfDaily) * 252`, denominator = `downsideDeviation(returns, rfDaily)`. `NaN` when denom = 0.
- [ ] `calmar(cagr, maxDdDepth)` = `cagr / |maxDdDepth|`. `Infinity` when `maxDdDepth = 0`.

**Verify:** `npm test -- src/metrics/riskAdjusted.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write tests**

Create `src/metrics/riskAdjusted.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dailyRiskFree, sharpe, sortino, calmar } from './riskAdjusted';
import { mean, stdev } from './risk';

describe('dailyRiskFree', () => {
  it('compounds back to annual', () => {
    const d = dailyRiskFree(0.04);
    expect(Math.pow(1 + d, 252)).toBeCloseTo(1.04, 8);
  });
});

describe('sharpe', () => {
  it('matches manual computation with rf=0', () => {
    const r = [0.01, -0.005, 0.02, -0.01, 0.005];
    const m = mean(r);
    const s = stdev(r);
    expect(sharpe(r, 0)).toBeCloseTo((m / s) * Math.sqrt(252), 8);
  });

  it('NaN when stdev is 0', () => {
    expect(Number.isNaN(sharpe([0.001, 0.001, 0.001], 0))).toBe(true);
  });
});

describe('sortino', () => {
  it('finite for typical input, NaN when no downside', () => {
    expect(Number.isFinite(sortino([0.01, -0.005, 0.02, -0.01, 0.005], 0))).toBe(true);
    expect(Number.isNaN(sortino([0.01, 0.02, 0.03], 0))).toBe(true);
  });
});

describe('calmar', () => {
  it('cagr / |maxDD|', () => {
    expect(calmar(0.1, -0.2)).toBeCloseTo(0.5, 10);
  });
  it('Infinity when maxDD is 0', () => {
    expect(calmar(0.1, 0)).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement `src/metrics/riskAdjusted.ts`**

```ts
import { mean, stdev, downsideDeviation } from './risk';

const TRADING_DAYS = 252;

export function dailyRiskFree(annual: number): number {
  return Math.pow(1 + annual, 1 / TRADING_DAYS) - 1;
}

export function sharpe(returns: number[], rfAnnual: number): number {
  const rfDaily = dailyRiskFree(rfAnnual);
  const s = stdev(returns);
  if (s === 0) return NaN;
  return ((mean(returns) - rfDaily) / s) * Math.sqrt(TRADING_DAYS);
}

export function sortino(returns: number[], rfAnnual: number): number {
  const rfDaily = dailyRiskFree(rfAnnual);
  const dd = downsideDeviation(returns, rfDaily);
  if (dd === 0) return NaN;
  return ((mean(returns) - rfDaily) * TRADING_DAYS) / dd;
}

export function calmar(cagrValue: number, maxDdDepth: number): number {
  if (maxDdDepth === 0) return Infinity;
  return cagrValue / Math.abs(maxDdDepth);
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/metrics/riskAdjusted.ts src/metrics/riskAdjusted.test.ts
git commit -m "feat(metrics): Sharpe, Sortino, Calmar"
```

---

## Task 7: activity.ts — rebalances, trades, turnover, win-rate

**Goal:** Activity stats from `Trade[]` plus `DailyBar[]`.

**Files:**
- Create: `src/metrics/activity.ts`
- Create: `src/metrics/activity.test.ts`

**Acceptance Criteria:**
- [ ] `rebalanceCount(trades)` = distinct trade dates.
- [ ] `tradeCount(trades)` = `trades.length`.
- [ ] `turnover(trades, series, years)` excludes CASHX legs, normalizes by avg NAV, annualizes by years.
- [ ] `winRatePerRebalance(series, trades)`:
  - Boundaries = sorted distinct trade dates ∪ `{firstDate, lastDate}`.
  - For each consecutive pair, segment return = `NAV_b / NAV_a - 1` using the latest series bar with date ≤ boundary date.
  - `winRate = #(positive) / #(total)`.
  - If no rebalances inside series: 1 if total return > 0 else 0.

**Verify:** `npm test -- src/metrics/activity.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write tests**

Create `src/metrics/activity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { rebalanceCount, tradeCount, turnover, winRatePerRebalance } from './activity';
import type { Trade } from '../backtest/types';
import type { DailyBar } from '../handles/indicator';

const bars = (e: Array<[string, number]>): DailyBar[] => e.map(([date, value]) => ({ date, value }));

describe('rebalanceCount / tradeCount', () => {
  it('rebalanceCount = distinct trade dates', () => {
    const trades: Trade[] = [
      { date: '2024-01-02', symbol: 'SPY', quantity: 10, price: 100, action: 'buy' },
      { date: '2024-01-02', symbol: 'SHY', quantity: 5, price: 80, action: 'sell' },
      { date: '2024-02-01', symbol: 'SPY', quantity: 10, price: 110, action: 'sell' },
    ];
    expect(rebalanceCount(trades)).toBe(2);
    expect(tradeCount(trades)).toBe(3);
  });
});

describe('turnover', () => {
  it('excludes CASHX legs, normalizes by avg NAV, annualizes', () => {
    const trades: Trade[] = [
      { date: '2024-01-02', symbol: 'SPY', quantity: 10, price: 100, action: 'buy' }, // 1000
      { date: '2024-01-02', symbol: 'CASHX', quantity: 1000, price: 1, action: 'sell' }, // skipped
      { date: '2024-07-01', symbol: 'SPY', quantity: 5, price: 110, action: 'sell' }, // 550
    ];
    const series = bars([
      ['2024-01-02', 1000],
      ['2024-07-01', 1100],
      ['2024-12-31', 1200],
    ]);
    const avgNav = (1000 + 1100 + 1200) / 3;
    const expected = (1000 + 550) / avgNav / 1.0; // 1 year
    expect(turnover(trades, series, 1.0)).toBeCloseTo(expected, 6);
  });

  it('returns 0 with no trades', () => {
    expect(turnover([], bars([['2024-01-01', 100], ['2024-12-31', 110]]), 1)).toBe(0);
  });
});

describe('winRatePerRebalance', () => {
  it('NAV up across each segment → 1.0', () => {
    const series = bars([
      ['2024-01-01', 100],
      ['2024-04-01', 105],
      ['2024-07-01', 110],
      ['2024-12-31', 120],
    ]);
    const trades: Trade[] = [
      { date: '2024-04-01', symbol: 'SPY', quantity: 1, price: 100, action: 'buy' },
      { date: '2024-07-01', symbol: 'SPY', quantity: 1, price: 100, action: 'buy' },
    ];
    expect(winRatePerRebalance(series, trades)).toBe(1);
  });

  it('mixed segments produces fraction', () => {
    const series = bars([
      ['2024-01-01', 100],
      ['2024-04-01', 90],   // segment 1: -10% (loss)
      ['2024-07-01', 100],  // segment 2: +11% (win)
      ['2024-12-31', 105],  // segment 3: +5%  (win)
    ]);
    const trades: Trade[] = [
      { date: '2024-04-01', symbol: 'SPY', quantity: 1, price: 100, action: 'buy' },
      { date: '2024-07-01', symbol: 'SPY', quantity: 1, price: 100, action: 'buy' },
    ];
    expect(winRatePerRebalance(series, trades)).toBeCloseTo(2 / 3, 10);
  });

  it('no trades → 1 if total return > 0, else 0', () => {
    expect(winRatePerRebalance(bars([['2024-01-01', 100], ['2024-12-31', 110]]), [])).toBe(1);
    expect(winRatePerRebalance(bars([['2024-01-01', 100], ['2024-12-31', 90]]), [])).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement `src/metrics/activity.ts`**

```ts
import type { DailyBar } from '../handles/indicator';
import type { Trade } from '../backtest/types';

export function rebalanceCount(trades: Trade[]): number {
  const dates = new Set<string>();
  for (const t of trades) dates.add(t.date);
  return dates.size;
}

export function tradeCount(trades: Trade[]): number {
  return trades.length;
}

export function turnover(trades: Trade[], series: DailyBar[], years: number): number {
  if (years <= 0 || series.length === 0) return 0;
  let gross = 0;
  for (const t of trades) {
    if (t.symbol === 'CASHX') continue;
    gross += Math.abs(t.quantity * t.price);
  }
  let navSum = 0;
  for (const bar of series) navSum += bar.value;
  const avgNav = navSum / series.length;
  if (avgNav === 0) return 0;
  return gross / avgNav / years;
}

function navAtOrBefore(series: DailyBar[], date: string): number | null {
  // series is ascending by date; return last bar with bar.date <= date.
  let result: number | null = null;
  for (const bar of series) {
    if (bar.date <= date) result = bar.value;
    else break;
  }
  return result;
}

export function winRatePerRebalance(series: DailyBar[], trades: Trade[]): number {
  if (series.length < 2) return 0;
  const firstDate = series[0]!.date;
  const lastDate = series[series.length - 1]!.date;

  const distinctTradeDates = Array.from(new Set(trades.map((t) => t.date))).sort();
  const inRange = distinctTradeDates.filter((d) => d > firstDate && d < lastDate);

  if (inRange.length === 0) {
    const total = series[series.length - 1]!.value / series[0]!.value - 1;
    return total > 0 ? 1 : 0;
  }

  const boundaries = [firstDate, ...inRange, lastDate];
  let wins = 0;
  let total = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = navAtOrBefore(series, boundaries[i]!);
    const b = navAtOrBefore(series, boundaries[i + 1]!);
    if (a == null || b == null || a === 0) continue;
    total++;
    if (b / a - 1 > 0) wins++;
  }
  return total === 0 ? 0 : wins / total;
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/metrics/activity.ts src/metrics/activity.test.ts
git commit -m "feat(metrics): rebalances, trades, turnover, win rate per rebalance"
```

---

## Task 8: tables.ts — monthly grid, yearly list

**Goal:** Reshape `monthlyReturns` / `yearlyReturns` into the spec's table types. Yearly list includes partial years; monthly grid uses `null` for months outside `[from, to]`.

**Files:**
- Create: `src/metrics/tables.ts`
- Create: `src/metrics/tables.test.ts`

**Acceptance Criteria:**
- [ ] `buildMonthlyTable(monthly)` produces one row per year touched. `months[0..11]`, `null` for months not in input. `ytd` = compounded return across non-null months in that row, or `null` if none.
- [ ] `buildYearlyList(yearly)` returns `[{year, return}]` for every year (partial included), no filtering.

**Verify:** `npm test -- src/metrics/tables.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write tests**

Create `src/metrics/tables.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMonthlyTable, buildYearlyList } from './tables';
import type { MonthlyReturn, YearlyReturn } from './returns';

describe('buildMonthlyTable', () => {
  it('places returns in month slots, nulls elsewhere, computes YTD', () => {
    const monthly: MonthlyReturn[] = [
      { year: 2024, month: 0, return: 0.1, partial: false },
      { year: 2024, month: 1, return: -0.05, partial: false },
      { year: 2024, month: 2, return: 0.02, partial: false },
    ];
    const table = buildMonthlyTable(monthly);
    expect(table.rows).toHaveLength(1);
    const row = table.rows[0]!;
    expect(row.year).toBe(2024);
    expect(row.months[0]).toBeCloseTo(0.1, 10);
    expect(row.months[1]).toBeCloseTo(-0.05, 10);
    expect(row.months[2]).toBeCloseTo(0.02, 10);
    expect(row.months[3]).toBeNull();
    expect(row.ytd).toBeCloseTo(1.1 * 0.95 * 1.02 - 1, 10);
  });

  it('separates years, keeps row order ascending', () => {
    const monthly: MonthlyReturn[] = [
      { year: 2023, month: 11, return: 0.05, partial: true },
      { year: 2024, month: 0, return: 0.03, partial: false },
    ];
    const table = buildMonthlyTable(monthly);
    expect(table.rows.map((r) => r.year)).toEqual([2023, 2024]);
  });
});

describe('buildYearlyList', () => {
  it('returns all years including partial', () => {
    const yearly: YearlyReturn[] = [
      { year: 2023, return: 0.1, partial: true },
      { year: 2024, return: 0.2, partial: false },
    ];
    expect(buildYearlyList(yearly)).toEqual([
      { year: 2023, return: 0.1 },
      { year: 2024, return: 0.2 },
    ]);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Implement `src/metrics/tables.ts`**

```ts
import type { MonthlyReturnsTable } from './types';
import type { MonthlyReturn, YearlyReturn } from './returns';

export function buildMonthlyTable(monthly: MonthlyReturn[]): MonthlyReturnsTable {
  if (monthly.length === 0) return { rows: [] };

  const byYear = new Map<number, (number | null)[]>();
  for (const m of monthly) {
    let row = byYear.get(m.year);
    if (!row) {
      row = new Array(12).fill(null);
      byYear.set(m.year, row);
    }
    row[m.month] = m.return;
  }

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const rows = years.map((year) => {
    const months = byYear.get(year)!;
    let ytd: number | null = null;
    for (const v of months) {
      if (v == null) continue;
      ytd = (ytd == null ? 1 : 1 + ytd) * (1 + v) - 1;
    }
    return { year, months, ytd };
  });
  return { rows };
}

export function buildYearlyList(yearly: YearlyReturn[]): Array<{ year: number; return: number }> {
  return yearly.map((y) => ({ year: y.year, return: y.return }));
}
```

- [ ] **Step 4: Run, expect pass**

- [ ] **Step 5: Commit**

```bash
git add src/metrics/tables.ts src/metrics/tables.test.ts
git commit -m "feat(metrics): monthly grid + yearly list tables"
```

---

## Task 9: compute.ts — orchestrator

**Goal:** Wire all helpers into a single `computeMetrics(series, trades, options?) → MetricsResult`. Replace the stub from Task 1.

**Files:**
- Modify: `src/metrics/compute.ts`
- Create: `src/metrics/compute.test.ts`
- Modify: `src/metrics/index.ts` (add free helper exports)

**Acceptance Criteria:**
- [ ] `computeMetrics` returns a fully populated `MetricsResult` matching the spec.
- [ ] Defaults: `riskFreeRate = 0`, `topDrawdowns = 5`, `varConfidence = 0.95`.
- [ ] Throws on `series.length < 2`.
- [ ] Free helpers exported from `index.ts`: `computeMetrics`, `computeSharpe`, `computeSortino`, `computeDrawdownTable`, `computeMonthlyReturns`, `computeYearlyReturns`.

**Verify:** `npm test -- src/metrics/compute.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Write integration test**

Create `src/metrics/compute.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeMetrics } from './compute';
import type { DailyBar } from '../handles/indicator';
import type { Trade } from '../backtest/types';

function buildSeries(): DailyBar[] {
  // 2-year synthetic series, monthly endpoints only — enough for tables.
  const out: DailyBar[] = [];
  let v = 100;
  for (let y = 2023; y <= 2024; y++) {
    for (let m = 0; m < 12; m++) {
      // Last day of each month (approx — 28 keeps things simple).
      const last = new Date(Date.UTC(y, m + 1, 0));
      const dateStr = last.toISOString().slice(0, 10);
      // Alternate +2% and -1%.
      v *= m % 2 === 0 ? 1.02 : 0.99;
      out.push({ date: dateStr, value: v });
    }
  }
  // Ensure first bar covers 2023-01-01 so first month is "full" by our partial heuristic.
  out.unshift({ date: '2023-01-01', value: 100 });
  return out;
}

describe('computeMetrics integration', () => {
  it('returns a fully shaped MetricsResult', () => {
    const series = buildSeries();
    const trades: Trade[] = [
      { date: '2023-06-30', symbol: 'SPY', quantity: 10, price: 100, action: 'buy' },
      { date: '2024-06-30', symbol: 'SPY', quantity: 10, price: 110, action: 'sell' },
    ];
    const result = computeMetrics(series, trades, { riskFreeRate: 0.04 });

    expect(result.range.from).toBe(series[0]!.date);
    expect(result.range.to).toBe(series[series.length - 1]!.date);
    expect(result.range.years).toBeGreaterThan(1.9);

    expect(typeof result.returns.totalReturn).toBe('number');
    expect(typeof result.returns.cagr).toBe('number');
    expect(typeof result.risk.volatility).toBe('number');
    expect(result.risk.maxDrawdown).toBeDefined();
    expect(typeof result.riskAdjusted.sharpe).toBe('number');

    expect(result.activity.rebalances).toBe(2);
    expect(result.activity.trades).toBe(2);

    expect(result.tables.monthly.rows.length).toBeGreaterThan(0);
    expect(result.tables.yearly.length).toBeGreaterThan(0);
    expect(Array.isArray(result.tables.drawdowns)).toBe(true);
  });

  it('throws on series.length < 2', () => {
    expect(() => computeMetrics([], [])).toThrow(/at least 2 daily bars/);
  });

  it('respects topDrawdowns option', () => {
    const series: DailyBar[] = [
      { date: '2024-01-01', value: 100 },
      { date: '2024-01-02', value: 95 },  // -5%
      { date: '2024-01-03', value: 100 },
      { date: '2024-01-04', value: 90 },  // -10%
      { date: '2024-01-05', value: 100 },
      { date: '2024-01-06', value: 80 },  // -20%
      { date: '2024-01-07', value: 100 },
    ];
    expect(computeMetrics(series, [], { topDrawdowns: 1 }).tables.drawdowns).toHaveLength(1);
    expect(computeMetrics(series, [], { topDrawdowns: 5 }).tables.drawdowns).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run, expect fail**

- [ ] **Step 3: Replace `src/metrics/compute.ts`**

```ts
import type { DailyBar } from '../handles/indicator';
import type { Trade } from '../backtest/types';
import type { DrawdownEntry, MetricsOptions, MetricsResult } from './types';
import { dailyReturns, monthlyReturns, yearlyReturns } from './returns';
import {
  totalReturn,
  cagr,
  years,
  bestYear,
  worstYear,
  bestMonth,
  worstMonth,
  pctPositiveMonths,
} from './summary';
import {
  volatility,
  downsideDeviation,
  skewness,
  excessKurtosis,
  historicalVar,
  historicalCvar,
  ulcerIndex,
} from './risk';
import { computeDrawdownTable, currentDrawdown } from './drawdown';
import { sharpe, sortino, calmar, dailyRiskFree } from './riskAdjusted';
import { rebalanceCount, tradeCount, turnover, winRatePerRebalance } from './activity';
import { buildMonthlyTable, buildYearlyList } from './tables';

export function computeMetrics(
  series: DailyBar[],
  trades: Trade[],
  options: MetricsOptions = {},
): MetricsResult {
  if (series.length < 2) {
    throw new Error('metrics requires at least 2 daily bars');
  }
  const rfAnnual = options.riskFreeRate ?? 0;
  const topN = options.topDrawdowns ?? 5;
  const conf = options.varConfidence ?? 0.95;

  const ret = dailyReturns(series);
  const monthly = monthlyReturns(series);
  const yearly = yearlyReturns(series);
  const yrs = years(series);

  const dds = computeDrawdownTable(series, Math.max(topN, 1));
  const maxDd: DrawdownEntry = dds[0] ?? {
    peakDate: series[0]!.date,
    troughDate: series[0]!.date,
    recoveryDate: series[series.length - 1]!.date,
    depth: 0,
    durationDays: 0,
    underwaterDays: 0,
  };
  const cagrVal = cagr(series);

  return {
    range: { from: series[0]!.date, to: series[series.length - 1]!.date, years: yrs },
    returns: {
      totalReturn: totalReturn(series),
      cagr: cagrVal,
      bestYear: bestYear(yearly),
      worstYear: worstYear(yearly),
      bestMonth: bestMonth(monthly),
      worstMonth: worstMonth(monthly),
      pctPositiveMonths: pctPositiveMonths(monthly),
    },
    risk: {
      volatility: volatility(ret),
      downsideDeviation: downsideDeviation(ret, dailyRiskFree(rfAnnual)),
      maxDrawdown: maxDd,
      currentDrawdown: currentDrawdown(series),
      ulcerIndex: ulcerIndex(series),
      skew: skewness(ret),
      kurtosis: excessKurtosis(ret),
      var95: historicalVar(ret, conf),
      cvar95: historicalCvar(ret, conf),
    },
    riskAdjusted: {
      sharpe: sharpe(ret, rfAnnual),
      sortino: sortino(ret, rfAnnual),
      calmar: calmar(cagrVal, maxDd.depth),
    },
    activity: {
      rebalances: rebalanceCount(trades),
      trades: tradeCount(trades),
      turnover: turnover(trades, series, yrs),
      winRate: winRatePerRebalance(series, trades),
    },
    tables: {
      drawdowns: dds.slice(0, topN),
      monthly: buildMonthlyTable(monthly),
      yearly: buildYearlyList(yearly),
    },
  };
}
```

- [ ] **Step 4: Update `src/metrics/index.ts`**

```ts
export type {
  MetricsOptions,
  MetricsResult,
  DrawdownEntry,
  MonthlyReturnsTable,
} from './types';
export { computeMetrics } from './compute';
export { sharpe as computeSharpe, sortino as computeSortino } from './riskAdjusted';
export { computeDrawdownTable } from './drawdown';
export { monthlyReturns as computeMonthlyReturns, yearlyReturns as computeYearlyReturns } from './returns';
```

- [ ] **Step 5: Run, expect pass**

Run: `npm test -- src/metrics/`
Expected: all metrics tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/metrics/compute.ts src/metrics/compute.test.ts src/metrics/index.ts
git commit -m "feat(metrics): orchestrator + free helper exports"
```

---

## Task 10: SimulationHandle.metrics() + public exports + end-to-end test

**Goal:** Wire `metrics()` onto `SimulationHandle`. Add metrics types and helpers to the public SDK barrel. End-to-end test runs a real `runSimulation` and asserts `sim.metrics()` returns a sensible result.

**Files:**
- Modify: `src/backtest/types.ts` (add `metrics()` method)
- Modify: `src/index.ts` (add metrics exports)
- Create: `src/metrics/integration.test.ts`

**Acceptance Criteria:**
- [ ] `SimulationHandle.metrics(options?)` returns `MetricsResult`.
- [ ] No regression: `npm test` passes.
- [ ] `npm run lint` clean.
- [ ] `npm run build` succeeds and `dist/` contains `metrics` exports.

**Verify:** `npm test && npm run lint && npm run build`.

**Steps:**

- [ ] **Step 1: Write end-to-end test**

Create `src/metrics/integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runSimulation } from '../backtest/simulate';
import { PortfolioHandle } from '../handles/portfolio';
import { TickerHandle } from '../handles/ticker';
import { AllocationHandle } from '../handles/allocation';
import type { StrategyBar } from '../handles/strategy';

describe('SimulationHandle.metrics() end-to-end', () => {
  it('produces a populated MetricsResult from runSimulation output', () => {
    const spy = TickerHandle.fromResolved(
      {} as never,
      { id: 1, symbol: 'SPY', leverage: 1 },
    );
    const alloc = AllocationHandle.fromResolved({} as never, 1, [[spy, 1]]);
    const portfolio = PortfolioHandle.empty(1_000);

    // 12 monthly bars at SPY = 100 → 110 → 121 (compounding ~+10% per period not exact, illustrative).
    const dates: string[] = [];
    const values: number[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(2024, i, 28)).toISOString().slice(0, 10);
      dates.push(d);
      values.push(100 * Math.pow(1.01, i));
    }
    const bars: StrategyBar[] = dates.map((date) => ({ date, allocation: alloc }));
    const prices: Record<string, Record<string, number>> = { 'SPY:1': {} };
    for (let i = 0; i < dates.length; i++) {
      prices['SPY:1']![dates[i]!] = values[i]!;
    }
    const rebalanceDates = new Set(dates);

    const sim = runSimulation(bars, prices, rebalanceDates, portfolio);
    const result = sim.metrics();

    expect(result.range.from).toBe(sim.series[0]!.date);
    expect(result.range.to).toBe(sim.series[sim.series.length - 1]!.date);
    expect(result.returns.totalReturn).toBeGreaterThan(0);
    expect(result.activity.rebalances).toBeGreaterThan(0);
    expect(result.activity.trades).toBeGreaterThan(0);
  });
});
```

> **Note:** the exact `runSimulation` shape may require adjusting the test fixture (e.g. ticker fromResolved arguments, portfolio constructor). Inspect `src/backtest/simulate.test.ts` for current usage and mirror it. The assertions above are the load-bearing part — the setup is fixture detail.

- [ ] **Step 2: Run, expect fail**

Run: `npm test -- src/metrics/integration.test.ts`
Expected: FAIL — `sim.metrics is not a function`.

- [ ] **Step 3: Add `metrics()` to `SimulationHandle`**

Modify `src/backtest/types.ts`. Add import at top:

```ts
import { computeMetrics } from '../metrics/compute';
import type { MetricsOptions, MetricsResult } from '../metrics/types';
```

Add method to the class (place after `pushAndPreview`):

```ts
metrics(options: MetricsOptions = {}): MetricsResult {
  return computeMetrics(this.series, this.trades, options);
}
```

- [ ] **Step 4: Update `src/index.ts`**

Add at the bottom:

```ts
export type {
  MetricsOptions,
  MetricsResult,
  DrawdownEntry,
  MonthlyReturnsTable,
} from './metrics';
export {
  computeMetrics,
  computeSharpe,
  computeSortino,
  computeDrawdownTable,
  computeMonthlyReturns,
  computeYearlyReturns,
} from './metrics';
```

- [ ] **Step 5: Run all tests + lint + build**

Run:
```bash
npm test
npm run lint
npm run build
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/backtest/types.ts src/index.ts src/metrics/integration.test.ts
git commit -m "feat(metrics): SimulationHandle.metrics() + public exports"
```

- [ ] **Step 7: Update docs index**

Modify `docs/AGENTS.md`: add a row to the `specs/` table for the new spec, and a row to the `plans/` table for this plan.

```bash
git add docs/AGENTS.md
git commit -m "docs: index simulation-metrics spec and plan"
```

---

## Self-Review

- **Spec coverage:** every section of the spec maps to a task. Types → Task 1. Returns/buckets → Task 2. Summary stats → Task 3. Risk scalars → Task 4. Drawdown → Task 5. Risk-adjusted → Task 6. Activity → Task 7. Tables → Task 8. Orchestrator + free helpers → Task 9. SimulationHandle adapter + public surface → Task 10.
- **Type consistency:** `DrawdownEntry`, `MonthlyReturnsTable`, `MetricsResult`, `MetricsOptions` defined once in Task 1, referenced by name everywhere else. Ratio function names (`sharpe`/`sortino`/`calmar`) and helpers (`computeDrawdownTable`, `monthlyReturns`, `yearlyReturns`) consistent across tasks.
- **Edge cases covered:** <2 bars throws (Task 1 + 9); zero stdev → NaN Sharpe/Sortino (Task 6); no trades → winRate fallback (Task 7); ongoing drawdown → null recoveryDate (Task 5); partial first/last month or year filtered out of best/worst stats (Task 3).
- **No placeholders:** every step has the actual code.
