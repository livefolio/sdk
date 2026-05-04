# Calendars Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers-extended-cc:subagent-driven-development` (recommended) or `superpowers-extended-cc:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Companion spec:** `docs/specs/2026-05-02-calendars-module-design.md`

**Supersedes:** `docs/plans/2026-05-02-nyse-calendar.md` (brainstorm capture; widened scope from "NYSE port" to "calendars framework + NYSE + LSE").

**Goal:** Replace `USEquityCalendar` with a multi-exchange calendar framework — `ExchangeCalendar` abstract base + faithful `NYSEExchangeCalendar` and `LSEExchangeCalendar` ports of `pandas_market_calendars` — and widen the `Calendar` interface with session-time methods to unblock future intraday work.

**Architecture:** New module `src/calendars/` houses the framework (base class, holiday-rule helpers, registry) and per-exchange impls (one short-named file each). `Calendar` gains `schedule(range): ReadonlyArray<Session>` and `isEarlyClose(t): boolean` — single shared contract, no separate interface layer. TZ-aware timestamps via `luxon` (mirrors upstream's `pytz`). `USEquityCalendar` is deleted; the parity gate's `CALENDAR_IGNORE` allowance and divergences-spec Allowance 2 are removed once the new NYSE calendar passes parity.

**Tech Stack:** TypeScript strict mode (`noUncheckedIndexedAccess: true`), ES modules with extensionless imports, Vitest, tsup. New runtime dep: `luxon` + dev dep `@types/luxon`.

---

## File Structure

```
src/interfaces/
  calendar.ts                 (modified — widened interface + Session/TimeOfDay types)
  index.ts                    (modified — re-export Session, TimeOfDay)

src/calendars/                (NEW module)
  AGENTS.md                   (new)
  index.ts                    (new — barrel)
  exchange-calendar.ts        (new — abstract ExchangeCalendar base)
  exchange-calendar.test.ts   (new — base-class behavior via fake subclass)
  holiday-rules.ts            (new — nthWeekdayOfMonth, lastWeekdayOfMonth, easter, observed, HolidayRule, SpecialClose)
  holiday-rules.test.ts       (new)
  nyse.ts                     (new — NYSEExchangeCalendar)
  nyse.test.ts                (new — replaces us-equity-calendar.test.ts; covers the 3 fixed-bug dates)
  lse.ts                      (new — LSEExchangeCalendar)
  lse.test.ts                 (new)
  get-calendar.ts             (new — getCalendar registry)
  get-calendar.test.ts        (new)

src/reference/
  us-equity-calendar.ts       (DELETED)
  us-equity-calendar.test.ts  (DELETED)
  index.ts                    (modified — drop USEquityCalendar export)
  AGENTS.md                   (modified — drop calendar row)

src/                          (codemod targets)
  index.ts                    (modified — drop USEquityCalendar, add new exports)
  AGENTS.md                   (modified — add calendars/ row)
  features/integration.test.ts          (modified — import + new())
  tactical/from-spec.test.ts             (modified)
  tactical/integration.test.ts           (modified)
  strategy/run-backtest.test.ts          (modified)
  reference/backtest-executor.test.ts    (modified)

parity/
  src/parity.test.ts          (modified — codemod + drop CALENDAR_IGNORE)

docs/
  specs/2026-05-02-v0.4-parity-divergences.md  (modified — drop Allowance 2)
  plans/2026-05-02-nyse-calendar.md            (modified — supersede note at top)
  AGENTS.md                                    (modified — bullet list update)

package.json                  (modified — add luxon, @types/luxon)
```

---

## Tasks

### Task 1 — Widen `Calendar` interface + add `Session`/`TimeOfDay` types

**Goal:** Land the contract change in isolation. No impls satisfy the new methods yet — `USEquityCalendar` will become non-compiling at the end of this task, fixed in Task 11. To keep the build green in between, this task ALSO adds stub `schedule()`/`isEarlyClose()` methods to `USEquityCalendar` that throw `'not implemented — see calendars module'`. The stubs are deleted with the file in Task 11.

**Files:**
- Modify: `src/interfaces/calendar.ts`
- Modify: `src/interfaces/index.ts` — add `Session`, `TimeOfDay` to barrel
- Modify: `src/reference/us-equity-calendar.ts` — add throwing stub methods

**Acceptance Criteria:**
- [ ] `Calendar` has `schedule(range): ReadonlyArray<Session>` and `isEarlyClose(t: Date): boolean` methods
- [ ] `Session = { date: Date; open: Date; close: Date }` and `TimeOfDay = { h: number; m: number }` exported from `src/interfaces/index.ts`
- [ ] `USEquityCalendar` still implements `Calendar` (with throwing stubs)
- [ ] `npm run build && npm test` green

**Verify:** `npx tsc --noEmit && npm test -- src/interfaces` → exit 0

**Steps:**

- [ ] **Step 1:** Modify `src/interfaces/calendar.ts`:

```ts
import type { DateRange } from './types';

export type TimeOfDay = { h: number; m: number };
export type Session = { date: Date; open: Date; close: Date };

export interface Calendar {
  isOpen(t: Date): boolean;
  next(t: Date): Date;
  previous(t: Date): Date;
  sessions(range: DateRange): ReadonlyArray<Date>;
  schedule(range: DateRange): ReadonlyArray<Session>;
  isEarlyClose(t: Date): boolean;
}
```

- [ ] **Step 2:** Update `src/interfaces/index.ts` to re-export `Session` and `TimeOfDay`:

```ts
export type { Calendar, Session, TimeOfDay } from './calendar';
```

(Keep all other existing exports unchanged.)

- [ ] **Step 3:** Add throwing stubs to `src/reference/us-equity-calendar.ts` so the build stays green until Task 11 deletes the file. Append to the `USEquityCalendar` class body:

```ts
  schedule(_range: DateRange): ReadonlyArray<import('../interfaces/calendar').Session> {
    throw new Error('USEquityCalendar.schedule() not implemented — use NYSEExchangeCalendar from src/calendars');
  }

  isEarlyClose(_t: Date): boolean {
    throw new Error('USEquityCalendar.isEarlyClose() not implemented — use NYSEExchangeCalendar from src/calendars');
  }
```

- [ ] **Step 4:** Run `npx tsc --noEmit` and `npm test`. Both must pass. The stubs only throw if called; existing tests don't call them.

- [ ] **Step 5:** Commit.

```bash
git add src/interfaces/calendar.ts src/interfaces/index.ts src/reference/us-equity-calendar.ts
git commit -m "feat(calendar): widen Calendar interface with schedule() and isEarlyClose()"
```

---

### Task 2 — Add `luxon` dependency

**Goal:** Add `luxon` (runtime) and `@types/luxon` (dev) so `ExchangeCalendar` can construct TZ-aware open/close timestamps.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto via `npm install`)

**Acceptance Criteria:**
- [ ] `package.json` `dependencies` contains `"luxon": "^3.x"`
- [ ] `package.json` `devDependencies` contains `"@types/luxon": "^3.x"`
- [ ] `node_modules/luxon` exists after `npm install`
- [ ] `import { DateTime } from 'luxon'` resolves and typechecks in a smoke test

**Verify:** `npx tsc --noEmit -e "import { DateTime } from 'luxon'; console.log(DateTime.now().toISO());"` (or equivalent inline check) → exit 0

**Steps:**

- [ ] **Step 1:** Install:

```bash
npm install luxon
npm install --save-dev @types/luxon
```

- [ ] **Step 2:** Smoke-test that the import resolves. Create a throwaway file `tmp/luxon-check.ts`:

```ts
import { DateTime } from 'luxon';
const dt = DateTime.fromObject({ year: 2024, month: 11, day: 29, hour: 13 }, { zone: 'America/New_York' });
console.log(dt.toUTC().toISO());
```

Run `npx tsx tmp/luxon-check.ts` → prints `2024-11-29T18:00:00.000Z`. Delete `tmp/luxon-check.ts`.

- [ ] **Step 3:** Commit.

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add luxon for TZ-aware exchange calendars"
```

---

### Task 3 — Scaffold `src/calendars/` module

**Goal:** Empty module with AGENTS.md and an empty barrel. Lets later tasks add to a real directory and confirms the module is wired into the v0.4 source tree.

**Files:**
- Create: `src/calendars/index.ts`
- Create: `src/calendars/AGENTS.md`
- Modify: `src/AGENTS.md` (add `calendars/` row to Subdirectories table)

**Acceptance Criteria:**
- [ ] `src/calendars/index.ts` exists (initially empty — `export {};`)
- [ ] `src/calendars/AGENTS.md` describes the module purpose
- [ ] `src/AGENTS.md` Subdirectories table lists `calendars/`
- [ ] `npx tsc --noEmit` clean

**Verify:** `npx tsc --noEmit` → exit 0

**Steps:**

- [ ] **Step 1:** Create `src/calendars/index.ts`:

```ts
export {};
```

- [ ] **Step 2:** Create `src/calendars/AGENTS.md`:

```markdown
<!-- Parent: ../AGENTS.md -->

# src/calendars

## Purpose
Multi-exchange calendar framework. `ExchangeCalendar` is the abstract base; per-exchange classes (`NYSEExchangeCalendar`, `LSEExchangeCalendar`) override hooks for holidays, adhoc closures, special closes, and session times. Mirrors `pandas_market_calendars`'s class shape.

## Key Files

| File | Description |
|------|-------------|
| `exchange-calendar.ts` | `abstract class ExchangeCalendar implements Calendar` — shared scheduling/holiday/observance logic; subclasses provide `name`, `tz`, and override `regularHolidays`/`adhocHolidays`/`specialCloses`/`regularOpen`/`regularClose` |
| `holiday-rules.ts` | `HolidayRule`, `SpecialClose`, `nthWeekdayOfMonth`, `lastWeekdayOfMonth`, `easter`, `observed` |
| `nyse.ts` | `NYSEExchangeCalendar` — full faithful port (Juneteenth from 2022, MLK from 1998, adhoc closures, early closes) |
| `lse.ts` | `LSEExchangeCalendar` — UK bank holidays, Europe/London, early closes Christmas Eve and NYE 12:30 |
| `get-calendar.ts` | `getCalendar('NYSE' \| 'LSE')` registry |
| `index.ts` | Barrel |

## For AI Agents

### Working In This Directory
- Adding a new exchange? Create `src/calendars/<short-name>.ts`, extend `ExchangeCalendar`, add to `getCalendar`'s union, export from `index.ts` and `src/index.ts`
- Holiday rules with onset years use `validFrom`/`validUntil` — don't bake "year zero" defaults
- TZ-aware session times go through `luxon`; the public `Calendar` API stays free of luxon types
- The `Calendar` interface is the public contract. `ExchangeCalendar` is one implementation family — crypto/composite/test calendars implement `Calendar` directly without going through this base class
```

- [ ] **Step 3:** Update `src/AGENTS.md` Subdirectories table — add row between `tactical/` and `reference/`:

```markdown
| `calendars/` | `ExchangeCalendar` base + `NYSEExchangeCalendar` / `LSEExchangeCalendar` + holiday-rule helpers + `getCalendar` registry (see `calendars/AGENTS.md`) |
```

- [ ] **Step 4:** Verify and commit.

```bash
npx tsc --noEmit
git add src/calendars src/AGENTS.md
git commit -m "feat(calendars): scaffold src/calendars/ module"
```

---

### Task 4 — Implement `holiday-rules.ts` (TDD)

**Goal:** Shared rule helpers. Promotes the existing `nthWeekdayOfMonth`/`lastWeekdayOfMonth`/`easter`/`observed` helpers from `us-equity-calendar.ts` into a reusable module. Adds the full set of types from the spec — `HolidayRule`, `SpecialClose`, `SpecialOpen`, `AdhocTimeOverrides` — and the date-aware `SessionTimeRule` evaluator used to resolve era-varying open/close times.

**Files:**
- Create: `src/calendars/holiday-rules.ts`
- Create: `src/calendars/holiday-rules.test.ts`

**Acceptance Criteria:**
- [ ] Exports `nthWeekdayOfMonth(year, month, weekday, n)`, `lastWeekdayOfMonth(year, month, weekday)`, `easter(year)`, `observed(d)`
- [ ] Exports types `HolidayRule`, `SpecialClose`, `SpecialOpen`, `AdhocTimeOverrides`, `SessionTimeRule`, `TimeOfDay`
- [ ] Exports evaluators `resolveHolidays(rules, year)`, `resolveSpecialCloses(rules, year)`, `resolveSpecialOpens(rules, year)`, `resolveSessionTime(rules, date)`
- [ ] All helpers return `Date` at UTC midnight
- [ ] `resolveHolidays` honors `validFrom`/`validUntil` and `observe`
- [ ] `resolveSessionTime` returns the rule with the latest `effectiveFrom ≤ date`; falls back to the unbounded default rule
- [ ] Tests pass

**Verify:** `npx vitest run src/calendars/holiday-rules.test.ts` → green

**Steps:**

- [ ] **Step 1:** Write the failing test `src/calendars/holiday-rules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  easter,
  observed,
  resolveHolidays,
  type HolidayRule,
} from './holiday-rules';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('nthWeekdayOfMonth', () => {
  it('returns 3rd Monday of January 2024 (MLK Day)', () => {
    expect(nthWeekdayOfMonth(2024, 1, 1, 3).toISOString()).toBe(utc('2024-01-15').toISOString());
  });
  it('returns 4th Thursday of November 2024 (Thanksgiving)', () => {
    expect(nthWeekdayOfMonth(2024, 11, 4, 4).toISOString()).toBe(utc('2024-11-28').toISOString());
  });
});

describe('lastWeekdayOfMonth', () => {
  it('returns last Monday of May 2024 (Memorial Day)', () => {
    expect(lastWeekdayOfMonth(2024, 5, 1).toISOString()).toBe(utc('2024-05-27').toISOString());
  });
  it('returns last Monday of August 2024 (UK Summer Bank Holiday)', () => {
    expect(lastWeekdayOfMonth(2024, 8, 1).toISOString()).toBe(utc('2024-08-26').toISOString());
  });
});

describe('easter', () => {
  it('returns Easter Sunday 2024 (March 31)', () => {
    expect(easter(2024).toISOString()).toBe(utc('2024-03-31').toISOString());
  });
  it('returns Easter Sunday 2025 (April 20)', () => {
    expect(easter(2025).toISOString()).toBe(utc('2025-04-20').toISOString());
  });
});

describe('observed', () => {
  it('shifts Saturday → Friday', () => {
    expect(observed(utc('2022-01-01')).toISOString()).toBe(utc('2021-12-31').toISOString());
  });
  it('shifts Sunday → Monday', () => {
    expect(observed(utc('2023-01-01')).toISOString()).toBe(utc('2023-01-02').toISOString());
  });
  it('leaves weekdays unchanged', () => {
    expect(observed(utc('2024-01-01')).toISOString()).toBe(utc('2024-01-01').toISOString());
  });
});

describe('resolveHolidays', () => {
  const juneteenth: HolidayRule = {
    name: 'Juneteenth',
    resolve: (y) => new Date(Date.UTC(y, 5, 19)),
    validFrom: 2022,
    observe: true,
  };

  it('returns empty set when year is before validFrom', () => {
    const set = resolveHolidays([juneteenth], 2020);
    expect(set.size).toBe(0);
  });

  it('includes the rule when year >= validFrom', () => {
    const set = resolveHolidays([juneteenth], 2022); // June 19 2022 = Sunday → observed Monday June 20
    expect(set.has(utc('2022-06-20').getTime())).toBe(true);
  });

  it('honors validUntil', () => {
    const rule: HolidayRule = {
      name: 'X',
      resolve: (y) => new Date(Date.UTC(y, 0, 15)),
      validUntil: 2010,
    };
    expect(resolveHolidays([rule], 2011).size).toBe(0);
    expect(resolveHolidays([rule], 2010).size).toBe(1);
  });
});

describe('resolveSessionTime', () => {
  // Imported lazily to keep the import group above tidy when tests are split.
  it('returns the unbounded default when no era rule applies yet', async () => {
    const { resolveSessionTime } = await import('./holiday-rules');
    const time = resolveSessionTime(
      [{ time: { h: 10, m: 0 } }, { effectiveFrom: '1985-09-30', time: { h: 9, m: 30 } }],
      utc('1980-01-01'),
    );
    expect(time).toEqual({ h: 10, m: 0 });
  });
  it('picks the latest rule whose effectiveFrom ≤ date', async () => {
    const { resolveSessionTime } = await import('./holiday-rules');
    const rules = [
      { time: { h: 15, m: 0 } },
      { effectiveFrom: '1952-09-29', time: { h: 15, m: 30 } },
      { effectiveFrom: '1974-01-02', time: { h: 16, m: 0 } },
    ];
    expect(resolveSessionTime(rules, utc('1951-06-01'))).toEqual({ h: 15, m: 0 });
    expect(resolveSessionTime(rules, utc('1952-09-29'))).toEqual({ h: 15, m: 30 });
    expect(resolveSessionTime(rules, utc('1973-12-31'))).toEqual({ h: 15, m: 30 });
    expect(resolveSessionTime(rules, utc('1974-01-02'))).toEqual({ h: 16, m: 0 });
    expect(resolveSessionTime(rules, utc('2024-06-03'))).toEqual({ h: 16, m: 0 });
  });
});

describe('resolveSpecialOpens / resolveSpecialCloses', () => {
  it('SpecialOpen: returns Map<dayMs, TimeOfDay>', async () => {
    const { resolveSpecialOpens } = await import('./holiday-rules');
    const rules = [{ name: 'Late open', resolve: (y: number) => new Date(Date.UTC(y, 0, 15)), openAt: { h: 11, m: 0 } }];
    const map = resolveSpecialOpens(rules, 2024);
    expect(map.get(utc('2024-01-15').getTime())).toEqual({ h: 11, m: 0 });
  });
});
```

- [ ] **Step 2:** Run `npx vitest run src/calendars/holiday-rules.test.ts` — expect "Cannot find module".

- [ ] **Step 3:** Write the implementation `src/calendars/holiday-rules.ts`:

```ts
const MS_PER_DAY = 86_400_000;

export type TimeOfDay = { h: number; m: number };

export type HolidayRule = {
  name: string;
  resolve: (year: number) => Date | null;
  validFrom?: number;
  validUntil?: number;
  observe?: boolean;
};

export type SpecialClose = {
  name: string;
  resolve: (year: number) => Date | null;
  closeAt: TimeOfDay;
  validFrom?: number;
  validUntil?: number;
};

export type SpecialOpen = {
  name: string;
  resolve: (year: number) => Date | null;
  openAt: TimeOfDay;
  validFrom?: number;
  validUntil?: number;
};

/** Map of YYYY-MM-DD → override time. Used for one-off historical specials that don't fit a year-derived rule. */
export type AdhocTimeOverrides = ReadonlyMap<string, TimeOfDay>;

/**
 * Era-bounded session-time rule. Lookup picks the latest rule with `effectiveFrom ≤ date`.
 * Use `effectiveFrom: undefined` for the default (since-inception) rule.
 */
export type SessionTimeRule = {
  effectiveFrom?: string; // YYYY-MM-DD inclusive
  time: TimeOfDay;
};

export function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7));
}

export function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(last.getTime() - offset * MS_PER_DAY);
}

export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const L = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * L) / 451);
  const month = Math.floor((h + L - 7 * m + 114) / 31);
  const day = ((h + L - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

export function observed(d: Date): Date {
  const dow = d.getUTCDay();
  if (dow === 6) return new Date(d.getTime() - MS_PER_DAY);
  if (dow === 0) return new Date(d.getTime() + MS_PER_DAY);
  return d;
}

export function resolveHolidays(rules: ReadonlyArray<HolidayRule>, year: number): Set<number> {
  const out = new Set<number>();
  for (const rule of rules) {
    if (rule.validFrom !== undefined && year < rule.validFrom) continue;
    if (rule.validUntil !== undefined && year > rule.validUntil) continue;
    const raw = rule.resolve(year);
    if (raw === null) continue;
    const final = rule.observe ? observed(raw) : raw;
    out.add(final.getTime());
  }
  return out;
}

export function resolveSpecialCloses(
  rules: ReadonlyArray<SpecialClose>,
  year: number,
): Map<number, TimeOfDay> {
  const out = new Map<number, TimeOfDay>();
  for (const rule of rules) {
    if (rule.validFrom !== undefined && year < rule.validFrom) continue;
    if (rule.validUntil !== undefined && year > rule.validUntil) continue;
    const d = rule.resolve(year);
    if (d === null) continue;
    out.set(d.getTime(), rule.closeAt);
  }
  return out;
}

export function resolveSpecialOpens(
  rules: ReadonlyArray<SpecialOpen>,
  year: number,
): Map<number, TimeOfDay> {
  const out = new Map<number, TimeOfDay>();
  for (const rule of rules) {
    if (rule.validFrom !== undefined && year < rule.validFrom) continue;
    if (rule.validUntil !== undefined && year > rule.validUntil) continue;
    const d = rule.resolve(year);
    if (d === null) continue;
    out.set(d.getTime(), rule.openAt);
  }
  return out;
}

/**
 * Pick the rule with the latest `effectiveFrom ≤ date.toISOString().slice(0,10)`.
 * Rules without `effectiveFrom` are treated as the default (since inception).
 * Returns the matched rule's `time`, or `null` if no rule matches (impossible if a default rule is present).
 */
export function resolveSessionTime(
  rules: ReadonlyArray<SessionTimeRule>,
  date: Date,
): TimeOfDay {
  const key = date.toISOString().slice(0, 10);
  let best: SessionTimeRule | null = null;
  for (const rule of rules) {
    if (rule.effectiveFrom === undefined) {
      if (best === null) best = rule;
      continue;
    }
    if (rule.effectiveFrom <= key) {
      if (best === null || best.effectiveFrom === undefined || best.effectiveFrom < rule.effectiveFrom) {
        best = rule;
      }
    }
  }
  if (best === null) {
    throw new Error('resolveSessionTime: no matching rule (provide a default rule with no effectiveFrom)');
  }
  return best.time;
}
```

- [ ] **Step 4:** Run `npx vitest run src/calendars/holiday-rules.test.ts` — expect green.

- [ ] **Step 5:** Commit.

```bash
git add src/calendars/holiday-rules.ts src/calendars/holiday-rules.test.ts
git commit -m "feat(calendars): holiday-rule primitives (nthWeekdayOfMonth, easter, observed, resolveHolidays)"
```

---

### Task 5 — Implement `ExchangeCalendar` abstract base (TDD with fake subclass)

**Goal:** Concrete `Calendar` implementation that subclasses configure via abstract `name`/`tz` and overridable hooks. All scheduling, observance, weekmask, and session-time logic lives here once. TDD via a fake "TestCalendar" subclass that exercises every hook the historical port will need: era-varying session times, era-varying weekmask (Mon–Sat → Mon–Fri), special-open and special-close adhoc overrides.

**Files:**
- Create: `src/calendars/exchange-calendar.ts`
- Create: `src/calendars/exchange-calendar.test.ts`

**Acceptance Criteria:**
- [ ] `abstract class ExchangeCalendar implements Calendar` with abstract `name: string` and `tz: string`
- [ ] Overridable hooks (all date-aware where applicable):
  - `regularHolidays(): ReadonlyArray<HolidayRule>` — defaults to `[]`
  - `adhocHolidays(): ReadonlySet<string>` — literal YYYY-MM-DD set, defaults to empty
  - `specialCloses(): ReadonlyArray<SpecialClose>` — rule-driven early closes, defaults to `[]`
  - `specialClosesAdhoc(): AdhocTimeOverrides` — literal YYYY-MM-DD → TimeOfDay map, defaults to empty
  - `specialOpens(): ReadonlyArray<SpecialOpen>` — rule-driven late opens, defaults to `[]`
  - `specialOpensAdhoc(): AdhocTimeOverrides` — literal YYYY-MM-DD → TimeOfDay map, defaults to empty
  - `regularOpen(date: Date): TimeOfDay` — defaults to `{ h: 9, m: 30 }`
  - `regularClose(date: Date): TimeOfDay` — defaults to `{ h: 16, m: 0 }`
  - `weekmask(date: Date): ReadonlySet<number>` — defaults to `{1,2,3,4,5}`
- [ ] `isOpen` consults `weekmask(date)`, adhoc holidays, and the per-year holiday cache
- [ ] `schedule(range)` resolution order for open/close on each session: rule-driven special → adhoc special → `regularOpen(date)`/`regularClose(date)`. Adhoc wins over rule-driven (matches pandas_market_calendars).
- [ ] `isEarlyClose(t)` returns true iff the date appears in either `specialCloses` rule resolution or `specialClosesAdhoc`
- [ ] Per-year caches for holidays / specialCloses / specialOpens (avoid recomputing rules each call)
- [ ] Tests cover: weekday/weekend masking, holiday closure, adhoc holiday, era-varying weekmask (Saturday open before cutoff, closed after), era-varying session close (15:00 → 15:30 → 16:00), rule-driven special close, adhoc special close, adhoc-wins-over-rule precedence, `next`/`previous` skip closures, `isEarlyClose` for both rule and adhoc

**Verify:** `npx vitest run src/calendars/exchange-calendar.test.ts` → green

**Steps:**

- [ ] **Step 1:** Write `src/calendars/exchange-calendar.test.ts`. The TestCalendar exercises every hook a historical exchange would use:

```ts
import { describe, it, expect } from 'vitest';
import { ExchangeCalendar } from './exchange-calendar';
import type {
  HolidayRule,
  SpecialClose,
  SpecialOpen,
  AdhocTimeOverrides,
} from './holiday-rules';
import type { TimeOfDay } from '../interfaces/calendar';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const SAT_CUTOFF = '1952-09-29'; // Mon–Sat → Mon–Fri at this date

class TestCalendar extends ExchangeCalendar {
  readonly name = 'TEST';
  readonly tz = 'America/New_York';
  protected regularHolidays(): ReadonlyArray<HolidayRule> {
    return [
      { name: 'NYD',       resolve: (y) => new Date(Date.UTC(y, 0, 1)),  observe: true },
      { name: 'Christmas', resolve: (y) => new Date(Date.UTC(y, 11, 25)), observe: true },
    ];
  }
  protected adhocHolidays(): ReadonlySet<string> {
    return new Set(['2024-07-15', '1888-03-12']); // modern + historical adhoc
  }
  protected specialCloses(): ReadonlyArray<SpecialClose> {
    return [{ name: 'EarlyTest', resolve: (y) => new Date(Date.UTC(y, 6, 3)), closeAt: { h: 13, m: 0 } }];
  }
  protected specialClosesAdhoc(): AdhocTimeOverrides {
    return new Map([['2024-07-03', { h: 12, m: 0 }]]); // adhoc wins over rule-driven 13:00
  }
  protected specialOpens(): ReadonlyArray<SpecialOpen> {
    return [{ name: 'LateOpenTest', resolve: (y) => new Date(Date.UTC(y, 0, 8)), openAt: { h: 11, m: 0 } }];
  }
  protected specialOpensAdhoc(): AdhocTimeOverrides {
    return new Map([['1933-03-15', { h: 12, m: 0 }]]); // bank-holiday-style late open
  }
  // Era-varying close: 15:00 → 15:30 (1952-09-29) → 16:00 (1974-01-02)
  protected override regularClose(date: Date): TimeOfDay {
    const key = date.toISOString().slice(0, 10);
    if (key < '1952-09-29') return { h: 15, m: 0 };
    if (key < '1974-01-02') return { h: 15, m: 30 };
    return { h: 16, m: 0 };
  }
  protected override regularOpen(): TimeOfDay { return { h: 9, m: 30 }; }
  // Mon–Sat through 1952-09-29; Mon–Fri from then on.
  protected override weekmask(date: Date): ReadonlySet<number> {
    const key = date.toISOString().slice(0, 10);
    return key < SAT_CUTOFF
      ? new Set([1, 2, 3, 4, 5, 6])
      : new Set([1, 2, 3, 4, 5]);
  }
}

const cal = new TestCalendar();

describe('ExchangeCalendar (via TestCalendar)', () => {
  it('marks Monday open', () => expect(cal.isOpen(utc('2024-01-08'))).toBe(true));
  it('marks modern Saturday closed (post-cutoff)', () => expect(cal.isOpen(utc('2024-01-06'))).toBe(false));
  it('marks modern Sunday closed', () => expect(cal.isOpen(utc('2024-01-07'))).toBe(false));
  it('marks pre-cutoff Saturday open', () => expect(cal.isOpen(utc('1950-06-10'))).toBe(true));
  it('marks pre-cutoff Sunday closed (Sunday never open)', () => expect(cal.isOpen(utc('1950-06-11'))).toBe(false));
  it('marks post-cutoff Saturday closed (1953-06-13)', () => expect(cal.isOpen(utc('1953-06-13'))).toBe(false));
  it('marks Christmas closed', () => expect(cal.isOpen(utc('2024-12-25'))).toBe(false));
  it('marks Sunday-Christmas observed Monday closed (2022-12-26)', () => {
    expect(cal.isOpen(utc('2022-12-26'))).toBe(false);
  });
  it('marks modern adhoc closure closed', () => expect(cal.isOpen(utc('2024-07-15'))).toBe(false));
  it('marks historical adhoc closure closed (1888 blizzard)', () => {
    expect(cal.isOpen(utc('1888-03-12'))).toBe(false);
  });

  it('next() skips weekends in modern era', () => {
    expect(cal.next(utc('2024-01-05')).toISOString()).toBe(utc('2024-01-08').toISOString());
  });
  it('previous() skips weekends in modern era', () => {
    expect(cal.previous(utc('2024-01-08')).toISOString()).toBe(utc('2024-01-05').toISOString());
  });

  it('schedule() uses era-varying close: 1950 → 15:00 ET (= 19:00 UTC, EST since pre-DST-mod)', () => {
    // 1950-06-12 (Mon) — era 1: close 15:00 ET. June = EDT (UTC-4) = 19:00 UTC.
    const sched = cal.schedule({ from: utc('1950-06-12'), to: utc('1950-06-13') });
    expect(sched[0]!.close.toISOString()).toBe('1950-06-12T19:00:00.000Z');
  });
  it('schedule() uses era-varying close: 1973 → 15:30 ET', () => {
    // 1973-06-12 (Tue) EDT → 19:30 UTC
    const sched = cal.schedule({ from: utc('1973-06-12'), to: utc('1973-06-13') });
    expect(sched[0]!.close.toISOString()).toBe('1973-06-12T19:30:00.000Z');
  });
  it('schedule() uses era-varying close: modern → 16:00 ET (20:00 UTC EDT)', () => {
    const sched = cal.schedule({ from: utc('2024-06-03'), to: utc('2024-06-04') });
    expect(sched[0]!.open.toISOString()).toBe('2024-06-03T13:30:00.000Z');
    expect(sched[0]!.close.toISOString()).toBe('2024-06-03T20:00:00.000Z');
  });

  it('schedule() applies rule-driven special close (13:00 ET → 17:00 UTC EDT)', () => {
    // Use 2023 to avoid 2024-07-03 colliding with the adhoc override below
    const sched = cal.schedule({ from: utc('2023-07-03'), to: utc('2023-07-04') });
    expect(sched[0]!.close.toISOString()).toBe('2023-07-03T17:00:00.000Z');
  });
  it('schedule() applies adhoc-wins-over-rule (12:00 ET overrides 13:00 ET on 2024-07-03 → 16:00 UTC EDT)', () => {
    const sched = cal.schedule({ from: utc('2024-07-03'), to: utc('2024-07-04') });
    expect(sched[0]!.close.toISOString()).toBe('2024-07-03T16:00:00.000Z');
  });
  it('schedule() applies rule-driven special open (11:00 ET → 16:00 UTC EST in January)', () => {
    // Use 2024 - first 2024-01-08 is Monday; 11:00 ET in January = EST (UTC-5) = 16:00 UTC
    const sched = cal.schedule({ from: utc('2024-01-08'), to: utc('2024-01-09') });
    expect(sched[0]!.open.toISOString()).toBe('2024-01-08T16:00:00.000Z');
  });
  it('schedule() applies adhoc special open (1933-03-15 12:00 ET = 17:00 UTC EST → late open)', () => {
    // 1933-03-15 = Wednesday
    const sched = cal.schedule({ from: utc('1933-03-15'), to: utc('1933-03-16') });
    expect(sched[0]!.open.toISOString()).toBe('1933-03-15T17:00:00.000Z');
  });

  it('isEarlyClose() true for rule-driven special close', () => {
    expect(cal.isEarlyClose(utc('2023-07-03'))).toBe(true);
  });
  it('isEarlyClose() true for adhoc special close', () => {
    expect(cal.isEarlyClose(utc('2024-07-03'))).toBe(true);
  });
  it('isEarlyClose() false for a regular trading day', () => {
    expect(cal.isEarlyClose(utc('2024-07-08'))).toBe(false);
  });
});
```

- [ ] **Step 2:** Run the tests — expect "Cannot find module".

- [ ] **Step 3:** Write `src/calendars/exchange-calendar.ts`:

```ts
import { DateTime } from 'luxon';
import type { Calendar, Session, TimeOfDay } from '../interfaces/calendar';
import type { DateRange } from '../interfaces/types';
import {
  resolveHolidays,
  resolveSpecialCloses,
  resolveSpecialOpens,
  type HolidayRule,
  type SpecialClose,
  type SpecialOpen,
  type AdhocTimeOverrides,
} from './holiday-rules';

const MS_PER_DAY = 86_400_000;

const DEFAULT_WEEKMASK: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);
const EMPTY_ADHOC: AdhocTimeOverrides = new Map();

function ymdKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export abstract class ExchangeCalendar implements Calendar {
  abstract readonly name: string;
  abstract readonly tz: string;

  private readonly holidayCache = new Map<number, Set<number>>();
  private readonly specialCloseCache = new Map<number, Map<number, TimeOfDay>>();
  private readonly specialOpenCache = new Map<number, Map<number, TimeOfDay>>();

  // --- Hooks ---
  protected regularHolidays(): ReadonlyArray<HolidayRule> { return []; }
  protected adhocHolidays(): ReadonlySet<string> { return new Set(); }
  protected specialCloses(): ReadonlyArray<SpecialClose> { return []; }
  protected specialClosesAdhoc(): AdhocTimeOverrides { return EMPTY_ADHOC; }
  protected specialOpens(): ReadonlyArray<SpecialOpen> { return []; }
  protected specialOpensAdhoc(): AdhocTimeOverrides { return EMPTY_ADHOC; }
  protected regularOpen(_date: Date): TimeOfDay { return { h: 9, m: 30 }; }
  protected regularClose(_date: Date): TimeOfDay { return { h: 16, m: 0 }; }
  protected weekmask(_date: Date): ReadonlySet<number> { return DEFAULT_WEEKMASK; }

  // --- Caches ---
  private holidaysForYear(year: number): Set<number> {
    let set = this.holidayCache.get(year);
    if (!set) {
      set = resolveHolidays(this.regularHolidays(), year);
      this.holidayCache.set(year, set);
    }
    return set;
  }

  private specialClosesForYear(year: number): Map<number, TimeOfDay> {
    let map = this.specialCloseCache.get(year);
    if (!map) {
      map = resolveSpecialCloses(this.specialCloses(), year);
      this.specialCloseCache.set(year, map);
    }
    return map;
  }

  private specialOpensForYear(year: number): Map<number, TimeOfDay> {
    let map = this.specialOpenCache.get(year);
    if (!map) {
      map = resolveSpecialOpens(this.specialOpens(), year);
      this.specialOpenCache.set(year, map);
    }
    return map;
  }

  private normalize(t: Date): Date {
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  }

  // --- Public Calendar API ---
  isOpen(t: Date): boolean {
    const d = this.normalize(t);
    if (!this.weekmask(d).has(d.getUTCDay())) return false;
    if (this.adhocHolidays().has(ymdKey(d))) return false;
    const year = d.getUTCFullYear();
    if (this.holidaysForYear(year).has(d.getTime())) return false;
    return true;
  }

  next(t: Date): Date {
    let d = new Date(this.normalize(t).getTime() + MS_PER_DAY);
    while (!this.isOpen(d)) d = new Date(d.getTime() + MS_PER_DAY);
    return d;
  }

  previous(t: Date): Date {
    let d = new Date(this.normalize(t).getTime() - MS_PER_DAY);
    while (!this.isOpen(d)) d = new Date(d.getTime() - MS_PER_DAY);
    return d;
  }

  sessions(range: DateRange): ReadonlyArray<Date> {
    const out: Date[] = [];
    let d = this.normalize(range.from);
    const end = this.normalize(range.to).getTime();
    while (d.getTime() < end) {
      if (this.isOpen(d)) out.push(d);
      d = new Date(d.getTime() + MS_PER_DAY);
    }
    return out;
  }

  schedule(range: DateRange): ReadonlyArray<Session> {
    const days = this.sessions(range);
    return days.map((date) => ({
      date,
      open: this.localizedTimestamp(date, this.openTimeFor(date)),
      close: this.localizedTimestamp(date, this.closeTimeFor(date)),
    }));
  }

  isEarlyClose(t: Date): boolean {
    const d = this.normalize(t);
    if (!this.isOpen(d)) return false;
    if (this.specialClosesAdhoc().has(ymdKey(d))) return true;
    return this.specialClosesForYear(d.getUTCFullYear()).has(d.getTime());
  }

  // --- Resolution ---
  /** Adhoc overrides win over rule-driven; both win over `regularOpen(date)`. */
  private openTimeFor(date: Date): TimeOfDay {
    const adhoc = this.specialOpensAdhoc().get(ymdKey(date));
    if (adhoc) return adhoc;
    const ruled = this.specialOpensForYear(date.getUTCFullYear()).get(date.getTime());
    if (ruled) return ruled;
    return this.regularOpen(date);
  }

  private closeTimeFor(date: Date): TimeOfDay {
    const adhoc = this.specialClosesAdhoc().get(ymdKey(date));
    if (adhoc) return adhoc;
    const ruled = this.specialClosesForYear(date.getUTCFullYear()).get(date.getTime());
    if (ruled) return ruled;
    return this.regularClose(date);
  }

  private localizedTimestamp(date: Date, time: TimeOfDay): Date {
    const dt = DateTime.fromObject(
      {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
        hour: time.h,
        minute: time.m,
      },
      { zone: this.tz },
    );
    return new Date(dt.toUTC().toMillis());
  }
}
```

- [ ] **Step 4:** Run `npx vitest run src/calendars/exchange-calendar.test.ts` — expect green. If observed-NYD test fails, double-check `observed()` direction (Saturday → Friday).

- [ ] **Step 5:** Commit.

```bash
git add src/calendars/exchange-calendar.ts src/calendars/exchange-calendar.test.ts
git commit -m "feat(calendars): ExchangeCalendar abstract base with TZ-aware schedule()"
```

---

### Task 6 — Implement `NYSEExchangeCalendar` (full faithful port, 1885+)

**Goal:** Faithful port of `pandas_market_calendars` NYSE calendar covering the full historical range (1885 onwards). This is the largest task in the plan — the data volume is substantial. The port must match upstream's behavior on every date pandas_market_calendars covers; representative tests verify each era and category.

**Upstream source files (the source of truth — port faithfully):**
- `pandas_market_calendars/calendars/nyse.py` — class structure, session times by era, weekmask cutoff
- `pandas_market_calendars/holidays/nyse.py` — every regular holiday rule, every adhoc closure, every special close
- Upstream repo: https://github.com/rsheftel/pandas_market_calendars

**Files:**
- Create: `src/calendars/nyse.ts`
- Create: `src/calendars/nyse.test.ts`

**Acceptance Criteria:**
- [ ] `class NYSEExchangeCalendar extends ExchangeCalendar` with `name='NYSE'`, `tz='America/New_York'`
- [ ] **Era-varying regular session:** open `10:00 → 09:30 (effective 1985-09-30)`; close `15:00 → 15:30 (effective 1952-09-29) → 16:00 (effective 1974-01-02)`
- [ ] **Variable weekmask:** Mon–Sat through 1952-09-29, Mon–Fri from 1952-09-29 onward
- [ ] **Regular holidays (all from upstream `holidays/nyse.py`)** with correct era boundaries:
  - **Always-on (with custom NYD-Saturday rule):** New Year's Day (custom resolver — NO Friday closure when on Saturday), Good Friday, Independence Day (observed), Christmas (observed), Thanksgiving (4th Thu Nov)
  - **Onset/sunset rules:** MLK Day (3rd Mon Jan, `validFrom: 1998`), Juneteenth (`validFrom: 2022`, observed), Lincoln's Birthday (Feb 12, `validUntil: 1953`), Washington's Birthday fixed Feb 22 (`validUntil: 1970`) → Presidents' Day 3rd Mon Feb (`validFrom: 1971`), Memorial Day fixed May 30 (`validUntil: 1970`) → last Mon May (`validFrom: 1971`), Columbus Day (`validUntil: 1953`, second Mon Oct), Election Day (`validUntil: 1969`, plus sporadic later years), Veterans Day / Armistice Day (observance varies; check upstream)
  - **Saturday-trading-cutoff rule:** explicit "Saturdays Closed from 1952-09-29" — implemented via the variable `weekmask`, NOT a holiday rule
- [ ] **Adhoc holidays — full upstream list back to 1885.** This is a large literal set; every entry from upstream's `holidays/nyse.py` adhoc lists must be present. Categories include:
  - **Presidential funerals:** Garfield 1881-09-26, McKinley 1901-09-19, Harding 1923-08-10, FDR 1945-04-14, Hoover 1964-10-23, Eisenhower 1969-03-31, Truman 1972-12-28, LBJ 1973-01-25, Nixon 1994-04-27, Reagan 2004-06-11, Ford 2007-01-02, GHWB 2018-12-05, Carter 2025-01-09
  - **National days of mourning:** Kennedy 1963-11-25, MLK 1968-04-09, RFK 1968-06-08, 9/11 anniversary 2001 reopens, etc.
  - **Wars and emergencies:** WWI shutdown 1914-07-31 through 1914-12-11 (every weekday + Saturdays per pre-1952 weekmask — but check upstream as some Saturdays were "limited trading"), 1918 wartime closures, 1933 bank holidays (1933-03-04 through 1933-03-14)
  - **Weather/disasters:** 1888 blizzard (1888-03-12, 1888-03-13), 1969 snowstorm (1969-02-10), 1977 NYC blackout (1977-07-14), 1985 Hurricane Gloria (1985-09-27), 1996 blizzard (1996-01-08), Hurricane Sandy 2012-10-29 / 2012-10-30
  - **9/11:** 2001-09-11, 2001-09-12, 2001-09-13, 2001-09-14
  - **Paperwork-crisis Wednesdays 1968:** Every Wednesday from 1968-06-12 through 1968-12-31 was closed for "back-office" reasons (per upstream)
  - **Other one-offs:** 1973-01-22 (Truman funeral, separate from 1972-12-28), 1929 crash week early closes (these are special_closes not holidays — see below)
- [ ] **Rule-driven special closes:**
  - Day-after-Thanksgiving 13:00 ET, `validFrom: 1992`
  - Christmas Eve 13:00 ET when on weekday, `validFrom: 1996`
  - July 3 13:00 ET when July 4 is Mon–Fri (era rules per upstream — check `validFrom`)
  - Pre-1992 day-after-Thanksgiving variants (different close times per era)
- [ ] **Adhoc special closes — full upstream list.** Hundreds of entries: 14:00, 14:30, 15:00, 12:00 closes scattered through 1885–1990s. Use the literal `Map<string, TimeOfDay>` from `specialClosesAdhoc`. Categories per upstream:
  - 1929 crash week early closes
  - 1968 paperwork-crisis afternoons (when not full closures)
  - 1973–1975 oil-crisis closes
  - One-off NYSE-decreed early closes for events
- [ ] **Adhoc special opens — full upstream list.** Late opens (e.g. 1933-03-15 12:00 after the bank-holiday week, various 11:00 opens for snowstorms or events).
- [ ] **Tests cover at minimum these representative dates per era:**
  - **Pre-buggy fix (must pass):** 2020-06-19 OPEN, 2021-06-18 OPEN, 2021-12-31 OPEN
  - **Pre-1900:** Garfield funeral 1881-09-26 closed (if upstream covers it; otherwise nearest), 1888 blizzard 1888-03-12 closed
  - **WWI:** 1914-07-31 closed, 1914-12-12 OPEN (first reopen day per upstream)
  - **Saturday trading:** 1950-06-10 (Sat) OPEN, 1953-06-13 (Sat) closed, 1952-09-27 (last Sat session per upstream — verify)
  - **Inter-war:** 1933-03-04 closed (FDR bank holiday), 1933-03-15 OPEN at 12:00 ET (late open after bank holiday)
  - **Mid-century:** Lincoln's Birthday 1953-02-12 closed (`validUntil: 1953`), 1954-02-12 OPEN, Columbus Day 1953-10-12 closed, 1954-10-11 OPEN
  - **Post-Monday-Holiday-Act:** Washington's Birthday 1970-02-23 (Monday after Feb 22 Sun, fixed-date pre-MHA) — verify upstream behavior; 1971-02-15 (3rd Mon Feb) closed; 1970-05-25 (Memorial Day fixed May 30 was Saturday, so observed?) — verify upstream
  - **JFK era:** 1963-11-25 closed (JFK funeral), 1968-06-12 closed (paperwork Wed), 1968-04-09 closed (MLK funeral), 1968-06-08 closed (RFK funeral)
  - **Modern:** 9/11 2001-09-11 through 2001-09-14 closed, 2001-09-17 OPEN (first reopen), 2012-10-29 / 2012-10-30 closed (Sandy), 2018-12-05 closed (GHWB), 2025-01-09 closed (Carter funeral)
  - **MLK Day onset:** 1997-01-20 OPEN, 1998-01-19 closed
  - **Juneteenth onset:** 2021-06-18 OPEN, 2022-06-20 closed (June 19 was Sunday)
  - **NYD-Saturday rule:** 2027-12-31 OPEN (Jan 1 2028 = Saturday), 2021-12-31 OPEN (Jan 1 2022 = Saturday)
  - **Modern early closes:** 2024-11-29 (day-after-Thanksgiving) close 13:00 ET, 2024-12-24 close 13:00 ET, 2024-07-03 close 13:00 ET (July 4 = Thursday)
  - **Era-varying session close:** 1950-06-12 close 15:00 ET, 1973-06-12 close 15:30 ET, 2024-06-03 close 16:00 ET
  - **Era-varying session open:** 1985-09-27 (Friday before transition) open 10:00 ET, 1985-09-30 (transition Monday) open 09:30 ET

**Verify:** `npx vitest run src/calendars/nyse.test.ts` → green. The pandas_market_calendars test suite (`tests/test_nyse_calendar.py`) is the most thorough cross-check — pull spot checks from there.

**Steps:**

- [ ] **Step 1:** Pull `pandas_market_calendars` locally so you can port directly from source.

```bash
git clone --depth=1 https://github.com/rsheftel/pandas_market_calendars.git /tmp/pmc
ls /tmp/pmc/pandas_market_calendars/holidays/nyse.py
ls /tmp/pmc/pandas_market_calendars/calendars/nyse.py
ls /tmp/pmc/tests/test_nyse_calendar.py
```

- [ ] **Step 2:** Write `src/calendars/nyse.test.ts` covering every era listed under "Acceptance Criteria" above. Structure as nested `describe` blocks per era so failures localize quickly. Don't test against the full pandas_market_calendars test suite — pull representative dates per category. Skeleton:

```ts
import { describe, it, expect } from 'vitest';
import { NYSEExchangeCalendar } from './nyse';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const cal = new NYSEExchangeCalendar();

describe('NYSE — previously-buggy dates (parity gate)', () => {
  it('2020-06-19 OPEN', () => expect(cal.isOpen(utc('2020-06-19'))).toBe(true));
  it('2021-06-18 OPEN', () => expect(cal.isOpen(utc('2021-06-18'))).toBe(true));
  it('2021-12-31 OPEN', () => expect(cal.isOpen(utc('2021-12-31'))).toBe(true));
});

describe('NYSE — pre-1900', () => {
  it('Garfield funeral 1881-09-26 closed', () => {
    expect(cal.isOpen(utc('1881-09-26'))).toBe(false);
  });
  it('1888 blizzard 1888-03-12 closed', () => {
    expect(cal.isOpen(utc('1888-03-12'))).toBe(false);
  });
});

describe('NYSE — Saturday trading (Mon-Sat through 1952-09-29)', () => {
  it('1950-06-10 (Sat) OPEN', () => expect(cal.isOpen(utc('1950-06-10'))).toBe(true));
  it('1953-06-13 (Sat) closed', () => expect(cal.isOpen(utc('1953-06-13'))).toBe(false));
  it('1950 Sunday closed', () => expect(cal.isOpen(utc('1950-06-11'))).toBe(false));
});

describe('NYSE — WWI shutdown', () => {
  it('1914-07-31 closed', () => expect(cal.isOpen(utc('1914-07-31'))).toBe(false));
  // verify reopen date against upstream test
});

describe('NYSE — holiday onset/sunset', () => {
  it('Lincolns Birthday 1953-02-12 closed (last year)', () => {
    expect(cal.isOpen(utc('1953-02-12'))).toBe(false);
  });
  it('Lincolns Birthday 1954-02-12 OPEN', () => {
    expect(cal.isOpen(utc('1954-02-12'))).toBe(true);
  });
  it('Columbus Day 1953-10-12 closed (last year)', () => {
    expect(cal.isOpen(utc('1953-10-12'))).toBe(false);
  });
  it('Columbus Day 1954-10-11 OPEN', () => {
    expect(cal.isOpen(utc('1954-10-11'))).toBe(true);
  });
  it('MLK Day 1997-01-20 OPEN', () => {
    expect(cal.isOpen(utc('1997-01-20'))).toBe(true);
  });
  it('MLK Day 1998-01-19 closed (first year)', () => {
    expect(cal.isOpen(utc('1998-01-19'))).toBe(false);
  });
  it('Juneteenth 2021-06-18 OPEN', () => {
    expect(cal.isOpen(utc('2021-06-18'))).toBe(true);
  });
  it('Juneteenth 2022-06-20 closed', () => {
    expect(cal.isOpen(utc('2022-06-20'))).toBe(false);
  });
});

describe('NYSE — Monday-Holiday-Act transition (1971)', () => {
  it('Washingtons Birthday 1970-02-23 closed (Monday after Sun Feb 22)', () => {
    // Pre-MHA: Feb 22 fixed-date with Saturday→Friday or Sunday→Monday observance per upstream
    expect(cal.isOpen(utc('1970-02-23'))).toBe(false);
  });
  it('Presidents Day 1971-02-15 closed (3rd Mon Feb)', () => {
    expect(cal.isOpen(utc('1971-02-15'))).toBe(false);
  });
});

describe('NYSE — adhoc closures', () => {
  it('JFK funeral 1963-11-25 closed', () => {
    expect(cal.isOpen(utc('1963-11-25'))).toBe(false);
  });
  it('1968 paperwork-crisis Wednesday 1968-06-12 closed', () => {
    expect(cal.isOpen(utc('1968-06-12'))).toBe(false);
  });
  it('1968-04-09 MLK funeral closed', () => {
    expect(cal.isOpen(utc('1968-04-09'))).toBe(false);
  });
  it('1969-02-10 snowstorm closed', () => {
    expect(cal.isOpen(utc('1969-02-10'))).toBe(false);
  });
  it('1977-07-14 NYC blackout closed', () => {
    expect(cal.isOpen(utc('1977-07-14'))).toBe(false);
  });
  it('1985-09-27 Hurricane Gloria closed', () => {
    expect(cal.isOpen(utc('1985-09-27'))).toBe(false);
  });
  it('9/11 closed (2001-09-11 through 2001-09-14)', () => {
    expect(cal.isOpen(utc('2001-09-11'))).toBe(false);
    expect(cal.isOpen(utc('2001-09-14'))).toBe(false);
    expect(cal.isOpen(utc('2001-09-17'))).toBe(true); // first reopen
  });
  it('Hurricane Sandy 2012-10-29 / 2012-10-30 closed', () => {
    expect(cal.isOpen(utc('2012-10-29'))).toBe(false);
    expect(cal.isOpen(utc('2012-10-30'))).toBe(false);
  });
  it('GHWB funeral 2018-12-05 closed', () => {
    expect(cal.isOpen(utc('2018-12-05'))).toBe(false);
  });
  it('Carter funeral 2025-01-09 closed', () => {
    expect(cal.isOpen(utc('2025-01-09'))).toBe(false);
  });
});

describe('NYSE — era-varying session close', () => {
  it('1950 close = 15:00 ET (EDT June = 19:00 UTC)', () => {
    const s = cal.schedule({ from: utc('1950-06-12'), to: utc('1950-06-13') });
    expect(s[0]!.close.toISOString()).toBe('1950-06-12T19:00:00.000Z');
  });
  it('1973 close = 15:30 ET (EDT June = 19:30 UTC)', () => {
    const s = cal.schedule({ from: utc('1973-06-12'), to: utc('1973-06-13') });
    expect(s[0]!.close.toISOString()).toBe('1973-06-12T19:30:00.000Z');
  });
  it('2024 close = 16:00 ET (EDT June = 20:00 UTC)', () => {
    const s = cal.schedule({ from: utc('2024-06-03'), to: utc('2024-06-04') });
    expect(s[0]!.close.toISOString()).toBe('2024-06-03T20:00:00.000Z');
  });
});

describe('NYSE — era-varying session open (1985-09-30 transition)', () => {
  it('1985-09-27 (Fri before transition) open 10:00 ET (= 14:00 UTC EDT)', () => {
    const s = cal.schedule({ from: utc('1985-09-27'), to: utc('1985-09-28') });
    expect(s[0]!.open.toISOString()).toBe('1985-09-27T14:00:00.000Z');
  });
  it('1985-09-30 (Mon transition) open 09:30 ET (= 13:30 UTC EDT)', () => {
    const s = cal.schedule({ from: utc('1985-09-30'), to: utc('1985-10-01') });
    expect(s[0]!.open.toISOString()).toBe('1985-09-30T13:30:00.000Z');
  });
});

describe('NYSE — modern early closes', () => {
  it('Day after Thanksgiving 2024-11-29 close 13:00 ET (= 18:00 UTC EST)', () => {
    const s = cal.schedule({ from: utc('2024-11-29'), to: utc('2024-11-30') });
    expect(s[0]!.close.toISOString()).toBe('2024-11-29T18:00:00.000Z');
    expect(cal.isEarlyClose(utc('2024-11-29'))).toBe(true);
  });
  it('Christmas Eve 2024 close 13:00 ET', () => {
    const s = cal.schedule({ from: utc('2024-12-24'), to: utc('2024-12-25') });
    expect(s[0]!.close.toISOString()).toBe('2024-12-24T18:00:00.000Z');
  });
  it('July 3 2024 close 13:00 ET (July 4 = Thursday)', () => {
    const s = cal.schedule({ from: utc('2024-07-03'), to: utc('2024-07-04') });
    expect(s[0]!.close.toISOString()).toBe('2024-07-03T17:00:00.000Z');
  });
});

describe('NYSE — historical late open (adhoc special open)', () => {
  it('1933-03-15 OPEN at 12:00 ET after FDR bank holiday (= 17:00 UTC EST)', () => {
    expect(cal.isOpen(utc('1933-03-15'))).toBe(true);
    const s = cal.schedule({ from: utc('1933-03-15'), to: utc('1933-03-16') });
    expect(s[0]!.open.toISOString()).toBe('1933-03-15T17:00:00.000Z');
  });
});

describe('NYSE — NYD-Saturday rule (no Friday closure)', () => {
  it('2027-12-31 OPEN (2028-01-01 = Saturday)', () => {
    expect(cal.isOpen(utc('2027-12-31'))).toBe(true);
  });
  it('2021-12-31 OPEN (2022-01-01 = Saturday)', () => {
    expect(cal.isOpen(utc('2021-12-31'))).toBe(true);
  });
});
```

- [ ] **Step 3:** Run tests — expect "Cannot find module".

- [ ] **Step 4:** Write `src/calendars/nyse.ts`. Structure: top-of-file constants for the rule arrays and adhoc maps, then the class. Below is the **template** — every `// PORT FROM upstream` placeholder must be filled from `/tmp/pmc/pandas_market_calendars/holidays/nyse.py` as the source of truth. Note the **NYD override:** the default `observed()` shifts Saturday → Friday, but NYSE does NOT do this for New Year's Day.

```ts
import { ExchangeCalendar } from './exchange-calendar';
import {
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  easter,
  observed,
  type HolidayRule,
  type SpecialClose,
  type SpecialOpen,
  type AdhocTimeOverrides,
} from './holiday-rules';
import type { TimeOfDay } from '../interfaces/calendar';

const ms = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const MS_PER_DAY = 86_400_000;
const SAT_CUTOFF = '1952-09-29'; // From upstream — Mon-Sat → Mon-Fri at this date

// NYSE-specific NYD rule: when Jan 1 is Saturday, NO Friday closure.
// Otherwise use standard weekend-shift to Monday.
function nyseNewYearsDay(year: number): Date | null {
  const nyd = ms(year, 1, 1);
  const dow = nyd.getUTCDay();
  if (dow === 6) return null; // Saturday — no observance
  if (dow === 0) return new Date(nyd.getTime() + MS_PER_DAY); // Sunday → Monday
  return nyd;
}

// PORT FROM /tmp/pmc/pandas_market_calendars/holidays/nyse.py — every Holiday() entry maps to one HolidayRule below.
// Use validFrom/validUntil to express start_date / end_date from upstream Holiday() declarations.
const REGULAR_HOLIDAYS: ReadonlyArray<HolidayRule> = [
  { name: 'New Years Day',           resolve: nyseNewYearsDay /* observance baked in */ },
  { name: 'MLK Day',                 resolve: (y) => nthWeekdayOfMonth(y, 1, 1, 3), validFrom: 1998 },
  { name: 'Lincolns Birthday',       resolve: (y) => ms(y, 2, 12), validUntil: 1953, observe: true },
  { name: 'Washingtons Birthday (fixed)', resolve: (y) => ms(y, 2, 22), validUntil: 1970, observe: true },
  { name: 'Presidents Day',          resolve: (y) => nthWeekdayOfMonth(y, 2, 1, 3), validFrom: 1971 },
  { name: 'Good Friday',             resolve: (y) => new Date(easter(y).getTime() - 2 * MS_PER_DAY) },
  { name: 'Memorial Day (fixed)',    resolve: (y) => ms(y, 5, 30), validUntil: 1970, observe: true },
  { name: 'Memorial Day (last Mon)', resolve: (y) => lastWeekdayOfMonth(y, 5, 1), validFrom: 1971 },
  { name: 'Juneteenth',              resolve: (y) => ms(y, 6, 19), validFrom: 2022, observe: true },
  { name: 'Independence Day',        resolve: (y) => ms(y, 7, 4), observe: true },
  { name: 'Labor Day',               resolve: (y) => nthWeekdayOfMonth(y, 9, 1, 1) },
  { name: 'Columbus Day',            resolve: (y) => nthWeekdayOfMonth(y, 10, 1, 2), validUntil: 1953 },
  { name: 'Election Day (pre-1969)', resolve: /* PORT — varies by year, sporadic post-1969 */ () => null },
  { name: 'Veterans / Armistice Day',resolve: /* PORT FROM upstream — varies by era */ () => null },
  { name: 'Thanksgiving',            resolve: (y) => nthWeekdayOfMonth(y, 11, 4, 4) },
  { name: 'Christmas',               resolve: (y) => ms(y, 12, 25), observe: true },
];

// PORT FROM /tmp/pmc/pandas_market_calendars/holidays/nyse.py — concatenate every adhoc list:
// USNationalDaysofMourning, AssortedAdhocClosures, ChristmasAdhoc, etc.
// Categories below are illustrative — fill the entire upstream set.
const ADHOC: ReadonlySet<string> = new Set([
  // --- 19th century: presidential funerals + early adhoc ---
  '1881-09-26', // Garfield funeral
  '1888-03-12', '1888-03-13', // 1888 blizzard
  // --- 1901-1929 ---
  '1901-09-19', // McKinley funeral
  '1923-08-10', // Harding funeral
  // --- WWI shutdown ---
  '1914-07-31', '1914-08-01', /* ... fill every weekday + pre-cutoff Saturday through 1914-12-11 — see upstream */
  // --- 1933 FDR bank holidays ---
  '1933-03-04', '1933-03-06', '1933-03-07', '1933-03-08', '1933-03-09', '1933-03-10',
  '1933-03-11', '1933-03-13', '1933-03-14',
  // --- WWII / FDR ---
  '1945-04-14', // FDR funeral
  // --- Mid-century ---
  '1963-11-25', // JFK funeral
  '1964-10-23', // Hoover funeral
  '1968-04-09', // MLK funeral
  '1968-06-08', // RFK funeral
  // 1968 paperwork-crisis Wednesdays — every Wed 1968-06-12 through 1968-12-31
  '1968-06-12', '1968-06-19', '1968-06-26',
  '1968-07-03', '1968-07-10', '1968-07-17', '1968-07-24', '1968-07-31',
  '1968-08-07', '1968-08-14', '1968-08-21', '1968-08-28',
  '1968-09-04', '1968-09-11', '1968-09-18', '1968-09-25',
  '1968-10-02', '1968-10-09', '1968-10-16', '1968-10-23', '1968-10-30',
  '1968-11-06', '1968-11-13', '1968-11-20', '1968-11-27',
  '1968-12-04', '1968-12-11', '1968-12-18', '1968-12-25', // Note: 1968-12-25 is also Christmas
  '1969-02-10', // 1969 snowstorm
  '1969-03-31', // Eisenhower funeral
  '1972-12-28', // Truman funeral
  '1973-01-25', // LBJ funeral
  // --- Modern ---
  '1977-07-14', // NYC blackout
  '1985-09-27', // Hurricane Gloria
  '1994-04-27', // Nixon funeral
  '1996-01-08', // 1996 blizzard
  '2001-09-11', '2001-09-12', '2001-09-13', '2001-09-14', // 9/11
  '2004-06-11', // Reagan funeral
  '2007-01-02', // Ford funeral
  '2012-10-29', '2012-10-30', // Hurricane Sandy
  '2018-12-05', // GHWB funeral
  '2025-01-09', // Carter funeral
  // PORT FROM upstream — verify against /tmp/pmc/pandas_market_calendars/holidays/nyse.py
  // particularly ChristmasAdhoc, USNationalDaysofMourning, USPresidentialFuneralEvent
]);

const EARLY_CLOSE_13_00: TimeOfDay = { h: 13, m: 0 };

// Rule-driven special closes (recurring with `validFrom`).
const SPECIAL_CLOSES: ReadonlyArray<SpecialClose> = [
  {
    name: 'Day after Thanksgiving 13:00',
    resolve: (y) => new Date(nthWeekdayOfMonth(y, 11, 4, 4).getTime() + MS_PER_DAY),
    closeAt: EARLY_CLOSE_13_00,
    validFrom: 1992, // Per upstream — earlier years had different early-close behavior
  },
  {
    name: 'Christmas Eve (weekday)',
    resolve: (y) => {
      const eve = ms(y, 12, 24);
      const dow = eve.getUTCDay();
      return dow === 0 || dow === 6 ? null : eve;
    },
    closeAt: EARLY_CLOSE_13_00,
    validFrom: 1996,
  },
  {
    name: 'July 3 when July 4 is Mon–Fri',
    resolve: (y) => {
      const jul4 = ms(y, 7, 4);
      const dow = jul4.getUTCDay();
      if (dow === 0 || dow === 6) return null;
      return ms(y, 7, 3);
    },
    closeAt: EARLY_CLOSE_13_00,
    // PORT: validFrom per upstream
  },
  // PORT remaining rule-driven closes from upstream (e.g. Day-After-Thanksgiving 14:00 era pre-1992)
];

// Adhoc special closes — PORT FROM upstream's _adhoc lists keyed by close time.
// Hundreds of entries; categories from upstream:
//   - 1929 crash week (multiple 12:00 / 14:30 closes)
//   - 1968 paperwork-crisis afternoons (when not full closures)
//   - 1973-1975 oil-crisis closes
//   - One-off NYSE-decreed early closes (e.g. weather, events)
const SPECIAL_CLOSES_ADHOC: AdhocTimeOverrides = new Map([
  // PORT FROM /tmp/pmc/pandas_market_calendars/holidays/nyse.py:
  //   USEarlyClose1pm_1701-Adhoc, USEarlyClose2pm_1701-Adhoc, etc.
  // Example shape:
  ['1929-10-25', { h: 12, m: 0 }],
  ['1929-10-28', { h: 12, m: 0 }],
  // ... continue for every adhoc close from upstream
]);

// Adhoc special opens — PORT FROM upstream.
const SPECIAL_OPENS_ADHOC: AdhocTimeOverrides = new Map([
  ['1933-03-15', { h: 12, m: 0 }], // Late open after FDR bank holiday
  // PORT remaining adhoc late opens from upstream
]);

const SPECIAL_OPENS: ReadonlyArray<SpecialOpen> = [
  // PORT any rule-driven late-open patterns from upstream (rare for NYSE)
];

export class NYSEExchangeCalendar extends ExchangeCalendar {
  readonly name = 'NYSE';
  readonly tz = 'America/New_York';

  protected override regularHolidays() { return REGULAR_HOLIDAYS; }
  protected override adhocHolidays() { return ADHOC; }
  protected override specialCloses() { return SPECIAL_CLOSES; }
  protected override specialClosesAdhoc() { return SPECIAL_CLOSES_ADHOC; }
  protected override specialOpens() { return SPECIAL_OPENS; }
  protected override specialOpensAdhoc() { return SPECIAL_OPENS_ADHOC; }

  // Era-varying open: 10:00 default → 09:30 effective 1985-09-30
  protected override regularOpen(date: Date): TimeOfDay {
    const key = date.toISOString().slice(0, 10);
    return key < '1985-09-30' ? { h: 10, m: 0 } : { h: 9, m: 30 };
  }

  // Era-varying close: 15:00 → 15:30 (1952-09-29) → 16:00 (1974-01-02).
  // Saturday sessions pre-1952: 12:00 winter, 13:00 summer (approximate as 12:00 — see spec out-of-scope note).
  protected override regularClose(date: Date): TimeOfDay {
    const key = date.toISOString().slice(0, 10);
    if (date.getUTCDay() === 6 && key < SAT_CUTOFF) {
      return { h: 12, m: 0 }; // Saturday half-session — see spec out-of-scope note re: summer/winter
    }
    if (key < '1952-09-29') return { h: 15, m: 0 };
    if (key < '1974-01-02') return { h: 15, m: 30 };
    return { h: 16, m: 0 };
  }

  protected override weekmask(date: Date): ReadonlySet<number> {
    const key = date.toISOString().slice(0, 10);
    return key < SAT_CUTOFF
      ? new Set([1, 2, 3, 4, 5, 6])
      : new Set([1, 2, 3, 4, 5]);
  }
}

void observed; // keep helper available for re-use in this file if needed
```

The shape above is the **target**. The volume of historical adhoc dates means actual file size will be ~400–600 lines — most of it the `ADHOC` set and `SPECIAL_CLOSES_ADHOC` map, both of which port directly from upstream Python lists.

- [ ] **Step 5:** Run `npx vitest run src/calendars/nyse.test.ts` — fix any failing dates by cross-referencing upstream. The most common issues:
  - Adhoc date forgotten from the literal set (test fails → look up date in upstream `holidays/nyse.py` → add to `ADHOC`)
  - Holiday rule with wrong `validFrom`/`validUntil` (test for the boundary year fails → check upstream `start_date`/`end_date` parameters)
  - Era cutoff date wrong (Saturday-trading or session-time tests fail → cross-check the cutoff string in `calendars/nyse.py`)

- [ ] **Step 6:** Cross-check against the parity range. Re-run the full parity test (it still has `CALENDAR_IGNORE` — that's removed in Task 12, but the gate should already be passing for all OTHER dates):

```bash
cd parity && npx vitest run src/parity.test.ts
```

If a date in the 2020-06 → 2024-12 range now fails, the bug is in the modern-era port — fix before committing.

- [ ] **Step 7:** Commit.

```bash
git add src/calendars/nyse.ts src/calendars/nyse.test.ts
git commit -m "feat(calendars): NYSEExchangeCalendar — full faithful port (1885+) of pandas_market_calendars"
```

---

### Task 7 — Implement `LSEExchangeCalendar` (full faithful port, 1801+)

**Goal:** Faithful port of `pandas_market_calendars` LSE calendar covering the full historical range. Different timezone (Europe/London), different national holidays, different bank-holiday era (Bank Holidays Acts 1871/1971), royal events as adhoc closures (weddings, jubilees, coronations, state funerals).

**Upstream source files (port faithfully):**
- `pandas_market_calendars/calendars/lse.py` — class structure, session times by era
- `pandas_market_calendars/holidays/uk.py` — UK bank holiday rules, royal adhoc closures, jubilees

**Files:**
- Create: `src/calendars/lse.ts`
- Create: `src/calendars/lse.test.ts`

**Acceptance Criteria:**
- [ ] `class LSEExchangeCalendar extends ExchangeCalendar` with `name='LSE'`, `tz='Europe/London'`
- [ ] Regular session 08:00–16:30 London local time (post-modernization). Era-varying session times if upstream has them — check upstream.
- [ ] **Regular holidays (all from upstream `holidays/uk.py`)** with correct era boundaries:
  - **Always-on:** New Year's Day (substitute Mon if weekend, `validFrom: 1974` per Bank Holidays Act), Good Friday, Easter Monday (easter + 1), Christmas Day (substitute), Boxing Day (substitute with Christmas-aware logic)
  - **Modern bank holidays (post-1971 Banking Act):** Early May Bank Holiday (`validFrom: 1978`, 1st Mon May), Spring Bank Holiday (last Mon May, `validFrom: 1971`), Summer Bank Holiday (last Mon Aug, `validFrom: 1971`)
  - **Pre-1971 era:** Whit Monday (= Pentecost Mon = easter + 50 days, `validUntil: 1971`), August Bank Holiday (1st Mon Aug, `validUntil: 1971`), other pre-modernization observances per upstream
  - **One-time substitutions per upstream:** Spring Bank Holiday moved to Jubilee dates in some years (1977 moved to honor Silver Jubilee, etc.)
- [ ] **Adhoc holidays — full upstream set including all royal events:**
  - **Royal weddings:** 1981-07-29 (Charles + Diana), 2011-04-29 (William + Kate)
  - **Coronations:** 1953-06-02 (Elizabeth II), 2023-05-08 (Charles III bank holiday for coronation)
  - **Jubilees:** 1977-06-07 (Silver), 2002-06-03 (Golden), 2012-06-05 (Diamond), 2022-06-03 (Platinum), plus the moved bank holidays around these
  - **State funerals:** 1965-01-30 (Churchill), 2022-09-19 (Queen Elizabeth II)
  - **Other:** 1999-12-31 (Millennium Eve, market closure), pre-modernization adhoc closures per upstream
- [ ] **Special closes (rule-driven):** Christmas Eve 12:30 London (when on weekday), New Year's Eve 12:30 London (when on weekday). Verify era boundaries against upstream — early-close conventions changed during modernization.
- [ ] **Special closes adhoc:** any one-off historical early closes per upstream
- [ ] **Tests cover at minimum these representative dates per era:**
  - **Modern bank holidays (2024):** Jan 1, Mar 29 (Good Fri), Apr 1 (Easter Mon), May 6 (Early May), May 27 (Spring), Aug 26 (Summer), Dec 25, Dec 26 — all closed
  - **Christmas-Saturday substitution:** 2021-12-27 (Christmas Mon substitute) closed, 2021-12-28 (Boxing Tue substitute) closed
  - **Pre-1978:** 1977-05-01 OPEN (Early May not yet established), 1977-05-30 closed (Spring Bank Holiday by 1971 rule)
  - **Pre-1971:** Whit Monday 1968-06-03 closed, August Bank Holiday 1968-08-05 (1st Mon Aug) closed, Spring Bank Holiday rule NOT in force pre-1971
  - **Royal weddings:** 1981-07-29 closed (Charles + Diana), 2011-04-29 closed (William + Kate)
  - **Coronations:** 1953-06-02 closed, 2023-05-08 closed
  - **Jubilees:** 1977-06-07, 2002-06-03, 2012-06-05, 2022-06-03 — all closed
  - **State funerals:** 1965-01-30 (Churchill) closed, 2022-09-19 (Queen Elizabeth II) closed
  - **Millennium Eve:** 1999-12-31 closed
  - **Early closes:** 2024-12-24 close 12:30 London (= 12:30 UTC GMT), 2024-12-31 close 12:30 London
  - **Session-time TZ:** 2024-06-03 close 16:30 London = 15:30 UTC (BST); 2024-12-24 close 12:30 London = 12:30 UTC (GMT)

**Verify:** `npx vitest run src/calendars/lse.test.ts` → green

**Steps:**

- [ ] **Step 1:** If not already done in Task 6, pull `pandas_market_calendars` locally:

```bash
git clone --depth=1 https://github.com/rsheftel/pandas_market_calendars.git /tmp/pmc
ls /tmp/pmc/pandas_market_calendars/holidays/uk.py
ls /tmp/pmc/pandas_market_calendars/calendars/lse.py
```

- [ ] **Step 2:** Write `src/calendars/lse.test.ts`. Structure as nested `describe` blocks per era:

```ts
import { describe, it, expect } from 'vitest';
import { LSEExchangeCalendar } from './lse';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const cal = new LSEExchangeCalendar();

describe('LSE — modern bank holidays (2024)', () => {
  it('New Years Day Jan 1 closed', () => expect(cal.isOpen(utc('2024-01-01'))).toBe(false));
  it('Good Friday Mar 29 closed', () => expect(cal.isOpen(utc('2024-03-29'))).toBe(false));
  it('Easter Monday Apr 1 closed', () => expect(cal.isOpen(utc('2024-04-01'))).toBe(false));
  it('Early May Bank Holiday May 6 closed', () => expect(cal.isOpen(utc('2024-05-06'))).toBe(false));
  it('Spring Bank Holiday May 27 closed', () => expect(cal.isOpen(utc('2024-05-27'))).toBe(false));
  it('Summer Bank Holiday Aug 26 closed', () => expect(cal.isOpen(utc('2024-08-26'))).toBe(false));
  it('Christmas + Boxing Day closed', () => {
    expect(cal.isOpen(utc('2024-12-25'))).toBe(false);
    expect(cal.isOpen(utc('2024-12-26'))).toBe(false);
  });
});

describe('LSE — Christmas/Boxing Day substitution', () => {
  it('Christmas-Sat 2021: substitute Mon Dec 27 + Boxing Tue Dec 28 closed', () => {
    expect(cal.isOpen(utc('2021-12-27'))).toBe(false);
    expect(cal.isOpen(utc('2021-12-28'))).toBe(false);
  });
  it('Christmas-Sun 2022: substitute Mon Dec 26 closed (Boxing) + Tue Dec 27 closed', () => {
    expect(cal.isOpen(utc('2022-12-26'))).toBe(false);
    expect(cal.isOpen(utc('2022-12-27'))).toBe(false);
  });
});

describe('LSE — pre-1978 era (Early May not yet established)', () => {
  it('1977-05-02 (1st Mon May 1977) OPEN — Early May not yet a bank holiday', () => {
    expect(cal.isOpen(utc('1977-05-02'))).toBe(true);
  });
  it('1978-05-01 closed — Early May first observed', () => {
    expect(cal.isOpen(utc('1978-05-01'))).toBe(false);
  });
});

describe('LSE — pre-1971 era', () => {
  it('Whit Monday 1968-06-03 closed (Pentecost Mon, validUntil: 1971 per upstream)', () => {
    // 1968-06-03 = Whit Monday (Pentecost was 1968-06-02)
    expect(cal.isOpen(utc('1968-06-03'))).toBe(false);
  });
  it('August Bank Holiday 1968-08-05 (1st Mon Aug, pre-1971 rule) closed', () => {
    expect(cal.isOpen(utc('1968-08-05'))).toBe(false);
  });
  it('Spring Bank Holiday rule not in force 1968-05-27 — verify against upstream', () => {
    // Behavior depends on upstream — adjust expectation based on actual port
    expect(cal.isOpen(utc('1968-05-27'))).toBe(true);
  });
});

describe('LSE — royal events', () => {
  it('Charles + Diana wedding 1981-07-29 closed', () => {
    expect(cal.isOpen(utc('1981-07-29'))).toBe(false);
  });
  it('William + Kate wedding 2011-04-29 closed', () => {
    expect(cal.isOpen(utc('2011-04-29'))).toBe(false);
  });
  it('Elizabeth II coronation 1953-06-02 closed', () => {
    expect(cal.isOpen(utc('1953-06-02'))).toBe(false);
  });
  it('Charles III coronation 2023-05-08 closed', () => {
    expect(cal.isOpen(utc('2023-05-08'))).toBe(false);
  });
});

describe('LSE — jubilees', () => {
  it('Silver Jubilee 1977-06-07 closed', () => expect(cal.isOpen(utc('1977-06-07'))).toBe(false));
  it('Golden Jubilee 2002-06-03 closed', () => expect(cal.isOpen(utc('2002-06-03'))).toBe(false));
  it('Diamond Jubilee 2012-06-05 closed', () => expect(cal.isOpen(utc('2012-06-05'))).toBe(false));
  it('Platinum Jubilee 2022-06-03 closed', () => expect(cal.isOpen(utc('2022-06-03'))).toBe(false));
});

describe('LSE — state funerals + Millennium', () => {
  it('Churchill state funeral 1965-01-30 closed', () => {
    expect(cal.isOpen(utc('1965-01-30'))).toBe(false);
  });
  it('Queen Elizabeth II state funeral 2022-09-19 closed', () => {
    expect(cal.isOpen(utc('2022-09-19'))).toBe(false);
  });
  it('Millennium Eve 1999-12-31 closed', () => {
    expect(cal.isOpen(utc('1999-12-31'))).toBe(false);
  });
});

describe('LSE — early closes + session-time TZ', () => {
  it('Christmas Eve 2024 close 12:30 London (= 12:30 UTC GMT)', () => {
    const s = cal.schedule({ from: utc('2024-12-24'), to: utc('2024-12-25') });
    expect(s[0]!.close.toISOString()).toBe('2024-12-24T12:30:00.000Z');
    expect(cal.isEarlyClose(utc('2024-12-24'))).toBe(true);
  });
  it('NYE 2024-12-31 close 12:30 London', () => {
    const s = cal.schedule({ from: utc('2024-12-31'), to: utc('2025-01-01') });
    expect(s[0]!.close.toISOString()).toBe('2024-12-31T12:30:00.000Z');
  });
  it('Regular June session close 16:30 London (= 15:30 UTC BST)', () => {
    const s = cal.schedule({ from: utc('2024-06-03'), to: utc('2024-06-04') });
    expect(s[0]!.close.toISOString()).toBe('2024-06-03T15:30:00.000Z');
  });
  it('Regular January session close 16:30 London (= 16:30 UTC GMT)', () => {
    const s = cal.schedule({ from: utc('2024-01-08'), to: utc('2024-01-09') });
    expect(s[0]!.close.toISOString()).toBe('2024-01-08T16:30:00.000Z');
  });
});
```

- [ ] **Step 3:** Run tests — expect "Cannot find module".

- [ ] **Step 4:** Write `src/calendars/lse.ts`. Below is the **template**; every `// PORT FROM upstream` placeholder must be filled from `/tmp/pmc/pandas_market_calendars/holidays/uk.py` and `/tmp/pmc/pandas_market_calendars/calendars/lse.py`.

```ts
import { ExchangeCalendar } from './exchange-calendar';
import {
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  easter,
  type HolidayRule,
  type SpecialClose,
} from './holiday-rules';
import type { TimeOfDay } from '../interfaces/calendar';

const ms = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const MS_PER_DAY = 86_400_000;

// UK Christmas/Boxing Day substitution rules (Banking and Financial Dealings Act 1971):
// Christmas-Sat → Mon Dec 27; Christmas-Sun → Mon Dec 26.
// Boxing-Sat → Mon Dec 28; Boxing-Sun → Tue Dec 28 (after Christmas Mon Dec 26).
function ukChristmas(year: number): Date {
  const xmas = ms(year, 12, 25);
  const dow = xmas.getUTCDay();
  if (dow === 6) return new Date(xmas.getTime() + 2 * MS_PER_DAY);
  if (dow === 0) return new Date(xmas.getTime() + 1 * MS_PER_DAY);
  return xmas;
}

function ukBoxingDay(year: number): Date {
  const boxing = ms(year, 12, 26);
  const dow = boxing.getUTCDay();
  if (dow === 6) return new Date(boxing.getTime() + 2 * MS_PER_DAY);
  if (dow === 0) return new Date(boxing.getTime() + 2 * MS_PER_DAY);
  if (dow === 1 && ms(year, 12, 25).getUTCDay() === 0) {
    return new Date(boxing.getTime() + 1 * MS_PER_DAY);
  }
  return boxing;
}

// Pentecost Monday (Whit Monday) = easter + 50 days.
function whitMonday(year: number): Date {
  return new Date(easter(year).getTime() + 50 * MS_PER_DAY);
}

// PORT FROM /tmp/pmc/pandas_market_calendars/holidays/uk.py — every Holiday() entry maps below.
// Use validFrom/validUntil from upstream's start_date/end_date parameters.
const REGULAR_HOLIDAYS: ReadonlyArray<HolidayRule> = [
  { name: 'New Years Day',           resolve: (y) => ms(y, 1, 1), observe: true, validFrom: 1974 /* per Bank Holidays Act */ },
  { name: 'Good Friday',             resolve: (y) => new Date(easter(y).getTime() - 2 * MS_PER_DAY) },
  { name: 'Easter Monday',           resolve: (y) => new Date(easter(y).getTime() + 1 * MS_PER_DAY) },
  { name: 'Whit Monday',             resolve: whitMonday, validUntil: 1970 },
  { name: 'Early May Bank Holiday',  resolve: (y) => nthWeekdayOfMonth(y, 5, 1, 1), validFrom: 1978 },
  { name: 'Spring Bank Holiday',     resolve: (y) => lastWeekdayOfMonth(y, 5, 1), validFrom: 1971 },
  { name: 'August Bank Holiday',     resolve: (y) => nthWeekdayOfMonth(y, 8, 1, 1), validUntil: 1970 },
  { name: 'Summer Bank Holiday',     resolve: (y) => lastWeekdayOfMonth(y, 8, 1), validFrom: 1971 },
  { name: 'Christmas Day',           resolve: ukChristmas },
  { name: 'Boxing Day',              resolve: ukBoxingDay },
  // PORT additional pre-1971 / pre-modernization rules from upstream
];

// PORT FROM upstream's adhoc_holidays — all royal events, jubilees, weddings, coronations, state funerals, Millennium.
const ADHOC: ReadonlySet<string> = new Set([
  '1965-01-30', // Churchill state funeral
  '1953-06-02', // Elizabeth II coronation
  '1977-06-07', // Silver Jubilee
  '1981-07-29', // Charles + Diana wedding
  '1999-12-31', // Millennium Eve
  '2002-06-03', // Golden Jubilee + moved Spring bank holiday (verify against upstream — may also need the moved-spring date)
  '2011-04-29', // William + Kate wedding
  '2012-06-05', // Diamond Jubilee + moved Spring bank holiday
  '2022-06-03', // Platinum Jubilee
  '2022-09-19', // Queen Elizabeth II state funeral
  '2023-05-08', // Charles III coronation
  // PORT remaining adhoc dates from upstream (pre-1971 era, additional royal events, etc.)
]);

const EARLY_CLOSE_12_30: TimeOfDay = { h: 12, m: 30 };

const SPECIAL_CLOSES: ReadonlyArray<SpecialClose> = [
  {
    name: 'Christmas Eve (weekday)',
    resolve: (y) => {
      const eve = ms(y, 12, 24);
      const dow = eve.getUTCDay();
      return dow === 0 || dow === 6 ? null : eve;
    },
    closeAt: EARLY_CLOSE_12_30,
    // PORT: validFrom from upstream — early-close convention started post-modernization
  },
  {
    name: 'New Years Eve (weekday)',
    resolve: (y) => {
      const eve = ms(y, 12, 31);
      const dow = eve.getUTCDay();
      return dow === 0 || dow === 6 ? null : eve;
    },
    closeAt: EARLY_CLOSE_12_30,
    // PORT: validFrom from upstream
  },
];

export class LSEExchangeCalendar extends ExchangeCalendar {
  readonly name = 'LSE';
  readonly tz = 'Europe/London';
  protected override regularHolidays() { return REGULAR_HOLIDAYS; }
  protected override adhocHolidays() { return ADHOC; }
  protected override specialCloses() { return SPECIAL_CLOSES; }
  protected override regularOpen(_date: Date): TimeOfDay { return { h: 8, m: 0 }; }
  protected override regularClose(_date: Date): TimeOfDay { return { h: 16, m: 30 }; }
  // PORT era-varying session times if upstream has them (LSE's session times have changed across modernization).
}
```

- [ ] **Step 5:** Run `npx vitest run src/calendars/lse.test.ts` — fix failures by cross-referencing `/tmp/pmc/pandas_market_calendars/holidays/uk.py`. Particular care for:
  - **BST/GMT transitions** — `Europe/London` is UTC+0 in winter, UTC+1 in summer. June close 16:30 London = 15:30 UTC; January close 16:30 London = 16:30 UTC.
  - **Pre-1971 era** — Whit Monday and August Bank Holiday rules differ from the modern equivalents
  - **Jubilee + moved Spring Bank Holiday** — some Jubilee years had the Spring Bank Holiday moved to honor the jubilee, with an additional bank holiday on a separate date. Cross-check upstream carefully.

- [ ] **Step 6:** Commit.

```bash
git add src/calendars/lse.ts src/calendars/lse.test.ts
git commit -m "feat(calendars): LSEExchangeCalendar — full faithful port of pandas_market_calendars UK calendar"
```

---

### Task 8 — Implement `getCalendar` registry

**Goal:** String-keyed factory for calendar instances. Mirrors `pandas_market_calendars.get_calendar`.

**Files:**
- Create: `src/calendars/get-calendar.ts`
- Create: `src/calendars/get-calendar.test.ts`

**Acceptance Criteria:**
- [ ] `getCalendar('NYSE')` returns a `NYSEExchangeCalendar` instance
- [ ] `getCalendar('LSE')` returns a `LSEExchangeCalendar` instance
- [ ] `ExchangeName` type is `'NYSE' | 'LSE'`
- [ ] Unknown name causes a TS compile error (exhaustive union)

**Verify:** `npx vitest run src/calendars/get-calendar.test.ts` → green

**Steps:**

- [ ] **Step 1:** Write `src/calendars/get-calendar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getCalendar } from './get-calendar';
import { NYSEExchangeCalendar } from './nyse';
import { LSEExchangeCalendar } from './lse';

describe('getCalendar', () => {
  it('returns NYSEExchangeCalendar for NYSE', () => {
    expect(getCalendar('NYSE')).toBeInstanceOf(NYSEExchangeCalendar);
  });
  it('returns LSEExchangeCalendar for LSE', () => {
    expect(getCalendar('LSE')).toBeInstanceOf(LSEExchangeCalendar);
  });
  it('returns a fresh instance each call', () => {
    expect(getCalendar('NYSE')).not.toBe(getCalendar('NYSE'));
  });
});
```

- [ ] **Step 2:** Run — expect "Cannot find module".

- [ ] **Step 3:** Write `src/calendars/get-calendar.ts`:

```ts
import { ExchangeCalendar } from './exchange-calendar';
import { NYSEExchangeCalendar } from './nyse';
import { LSEExchangeCalendar } from './lse';

export type ExchangeName = 'NYSE' | 'LSE';

export function getCalendar(name: ExchangeName): ExchangeCalendar {
  switch (name) {
    case 'NYSE': return new NYSEExchangeCalendar();
    case 'LSE':  return new LSEExchangeCalendar();
  }
}
```

- [ ] **Step 4:** Run tests — expect green.

- [ ] **Step 5:** Commit.

```bash
git add src/calendars/get-calendar.ts src/calendars/get-calendar.test.ts
git commit -m "feat(calendars): getCalendar registry for NYSE and LSE"
```

---

### Task 9 — Wire up barrels: `src/calendars/index.ts` and `src/index.ts`

**Goal:** Make the new module's surface available from both the module barrel and the public root barrel. Drop `USEquityCalendar` from the root barrel.

**Files:**
- Modify: `src/calendars/index.ts`
- Modify: `src/index.ts`

**Acceptance Criteria:**
- [ ] `src/calendars/index.ts` re-exports `ExchangeCalendar`, `NYSEExchangeCalendar`, `LSEExchangeCalendar`, `getCalendar`, types `ExchangeName`, `HolidayRule`, `SpecialClose`
- [ ] `src/index.ts` exports those plus re-exports `Session`, `TimeOfDay` from `./interfaces`
- [ ] `src/index.ts` no longer exports `USEquityCalendar`
- [ ] `npx tsc --noEmit` clean

**Verify:** `npx tsc --noEmit && npm test` → exit 0 (note: source-tree codemod happens in Task 10; tests using `USEquityCalendar` may still pass via direct import from `./reference/us-equity-calendar` until Task 11)

**Steps:**

- [ ] **Step 1:** Replace `src/calendars/index.ts` contents:

```ts
export { ExchangeCalendar } from './exchange-calendar';
export { NYSEExchangeCalendar } from './nyse';
export { LSEExchangeCalendar } from './lse';
export { getCalendar, type ExchangeName } from './get-calendar';
export type { HolidayRule, SpecialClose } from './holiday-rules';
```

- [ ] **Step 2:** Modify `src/index.ts`:
  - Remove `USEquityCalendar` from line 33: change `export { USEquityCalendar, MemoryFeatureCache, BacktestExecutor } from './reference';` to `export { MemoryFeatureCache, BacktestExecutor } from './reference';`
  - Add to the type-only `Calendar`/`FeatureCache`/etc. block in `interfaces`: `Session`, `TimeOfDay`
  - Add a new export block before the "Tactical dialect" section:

```ts
// Calendars (exchange calendar framework)
export {
  ExchangeCalendar,
  NYSEExchangeCalendar,
  LSEExchangeCalendar,
  getCalendar,
} from './calendars';
export type { ExchangeName, HolidayRule, SpecialClose } from './calendars';
```

- [ ] **Step 3:** Verify build.

```bash
npx tsc --noEmit
```

- [ ] **Step 4:** Commit.

```bash
git add src/calendars/index.ts src/index.ts
git commit -m "feat(calendars): wire calendars module into public API barrel"
```

---

### Task 10 — Codemod call sites: `USEquityCalendar` → `NYSEExchangeCalendar`

**Goal:** Update all 8 source-side call sites to use the new class. After this task, the new calendar runs everywhere `USEquityCalendar` did. The parity test still has `CALENDAR_IGNORE` (removed in Task 12).

**Files modified (8 total):**
- `src/features/integration.test.ts`
- `src/tactical/from-spec.test.ts`
- `src/tactical/integration.test.ts`
- `src/strategy/run-backtest.test.ts`
- `src/reference/backtest-executor.test.ts`
- `parity/src/parity.test.ts`

(Plus `src/reference/us-equity-calendar.test.ts` — but that file is deleted in Task 11, so don't bother updating it.)

**Acceptance Criteria:**
- [ ] All listed files import `NYSEExchangeCalendar` (from `'../calendars'` or `'@livefolio/sdk'` as appropriate) instead of `USEquityCalendar`
- [ ] All `new USEquityCalendar()` → `new NYSEExchangeCalendar()`
- [ ] `npm test` green (parity still has `CALENDAR_IGNORE` — removal is Task 12)
- [ ] `grep -rn "USEquityCalendar" src/ parity/src/ --include="*.test.ts" --include="*.ts" | grep -v us-equity-calendar` returns nothing

**Verify:** `npm test` → green

**Steps:**

- [ ] **Step 1:** For each file in the list, find the `USEquityCalendar` import line and `new USEquityCalendar()` call sites. Replace import and class name. Use this as the canonical edit pattern (paths vary, but the change is uniform):

```diff
- import { USEquityCalendar, MemoryFeatureCache, BacktestExecutor } from '../reference';
+ import { MemoryFeatureCache, BacktestExecutor } from '../reference';
+ import { NYSEExchangeCalendar } from '../calendars';
...
- const calendar = new USEquityCalendar();
+ const calendar = new NYSEExchangeCalendar();
```

For `parity/src/parity.test.ts`, the import comes from `'@livefolio/sdk'` (the workspace alias). Update accordingly:

```diff
- import {
-   USEquityCalendar,
-   ...
- } from '@livefolio/sdk';
+ import {
+   NYSEExchangeCalendar,
+   ...
+ } from '@livefolio/sdk';
...
- const calendar = new USEquityCalendar();
+ const calendar = new NYSEExchangeCalendar();
```

For `src/tactical/integration.test.ts`, `function makeExecutor(calendar: USEquityCalendar, ...)` becomes `function makeExecutor(calendar: NYSEExchangeCalendar, ...)` (or, cleaner, use the `Calendar` interface type — `function makeExecutor(calendar: Calendar, ...)` — and add the import). Either works; pick whichever introduces the smaller diff.

- [ ] **Step 2:** Run grep to verify nothing slipped through (the `us-equity-calendar.ts`/`.test.ts` files still exist; exclude them — they go in Task 11):

```bash
grep -rn "USEquityCalendar" src/ parity/src/ --include="*.ts" | grep -v "us-equity-calendar"
```

Expected: empty output.

- [ ] **Step 3:** Run tests.

```bash
npm test
```

Both `sdk` and `parity` test suites must pass. The parity gate still relies on `CALENDAR_IGNORE` to skip the three previously-buggy dates — `NYSEExchangeCalendar` should now produce the *correct* answer for those dates, but the v0.3 fixture-derived calendar matches that, so the diff stays empty. (If a date that *was* covered by `CALENDAR_IGNORE` now *fails* the parity gate, something in the NYSE port is wrong.)

- [ ] **Step 4:** Commit.

```bash
git add -A
git commit -m "refactor(calendars): codemod USEquityCalendar → NYSEExchangeCalendar"
```

---

### Task 11 — Delete `USEquityCalendar` and refresh reference module docs

**Goal:** Remove the dead file and its test; clean up the `src/reference/` module's barrel and AGENTS.md so they no longer reference the calendar.

**Files:**
- Delete: `src/reference/us-equity-calendar.ts`
- Delete: `src/reference/us-equity-calendar.test.ts`
- Modify: `src/reference/index.ts`
- Modify: `src/reference/AGENTS.md`

**Acceptance Criteria:**
- [ ] Both `us-equity-calendar.ts` and `us-equity-calendar.test.ts` are deleted (no longer in the working tree)
- [ ] `src/reference/index.ts` no longer exports `USEquityCalendar`
- [ ] `src/reference/AGENTS.md` no longer mentions `USEquityCalendar` or the deferred plan; the table has only `MemoryFeatureCache` and `BacktestExecutor`
- [ ] `grep -rn "USEquityCalendar\|us-equity-calendar" src/ parity/ scripts/ docs/` returns nothing
- [ ] `npm test` green

**Verify:** `npm test && grep -rn "USEquityCalendar\|us-equity-calendar" src/ parity/ scripts/ docs/` → tests green AND grep empty

**Steps:**

- [ ] **Step 1:** Delete the files.

```bash
git rm src/reference/us-equity-calendar.ts src/reference/us-equity-calendar.test.ts
```

- [ ] **Step 2:** Edit `src/reference/index.ts` — remove the `USEquityCalendar` export. Final contents:

```ts
export { MemoryFeatureCache } from './memory-feature-cache';
export { BacktestExecutor } from './backtest-executor';
export type { BacktestExecutorOptions, NextOpenFn } from './backtest-executor';
```

- [ ] **Step 3:** Edit `src/reference/AGENTS.md`:
  - Remove the `us-equity-calendar.ts` row from the Key Files table
  - Remove the bullet about "USEquityCalendar bugs are not fixed here yet"
  - Update the Purpose paragraph if it mentions calendars (it should now describe just `MemoryFeatureCache` and `BacktestExecutor`)

- [ ] **Step 4:** Verify nothing dangles.

```bash
grep -rn "USEquityCalendar\|us-equity-calendar" src/ parity/ scripts/ docs/
npm test
```

The grep should return empty (the old plan at `docs/plans/2026-05-02-nyse-calendar.md` references `us-equity-calendar.ts` — that's fine; it gets superseded in Task 13 with a header note). To be safe, exclude that file:

```bash
grep -rn "USEquityCalendar\|us-equity-calendar" src/ parity/ scripts/ docs/ --exclude="2026-05-02-nyse-calendar.md"
```

Expected: empty.

- [ ] **Step 5:** Commit.

```bash
git add -A
git commit -m "refactor(reference): remove USEquityCalendar (replaced by NYSEExchangeCalendar in calendars module)"
```

---

### Task 12 — Drop `CALENDAR_IGNORE` and Allowance 2

**Goal:** With the new NYSE calendar producing correct dates, the parity gate no longer needs to mask `2020-06-19`, `2021-06-18`, `2021-12-31`. Remove the allowance from both the test and the divergences spec.

**Files:**
- Modify: `parity/src/parity.test.ts`
- Modify: `docs/specs/2026-05-02-v0.4-parity-divergences.md`

**Acceptance Criteria:**
- [ ] `CALENDAR_IGNORE` is removed from `parity/src/parity.test.ts`
- [ ] All references to `CALENDAR_IGNORE` (filtering both v3 and v4 history before diff) are removed
- [ ] `## Allowance 2: Calendar drift (3 dates)` section is removed from the divergences spec
- [ ] The "What the test enforces" section count of allowances is updated (3 → 2)
- [ ] `npm test` green — parity gate passes without the allowance

**Verify:** `cd parity && npx vitest run src/parity.test.ts` → green

**Steps:**

- [ ] **Step 1:** Open `parity/src/parity.test.ts`. Find `CALENDAR_IGNORE` (a `Set<string>` of three YYYY-MM-DD strings) and the lines that filter `v3History` and `v4History` against it. Delete the constant and the filter lines.

- [ ] **Step 2:** Run the parity test alone.

```bash
cd parity && npx vitest run src/parity.test.ts
```

If it fails on any of the three previously-ignored dates, the NYSE calendar still has a bug — debug `nyse.ts` against `pandas_market_calendars`. If it passes, proceed.

- [ ] **Step 3:** Edit `docs/specs/2026-05-02-v0.4-parity-divergences.md`:
  - Delete the entire `## Allowance 2: Calendar drift (3 dates)` section (the section header and all paragraphs through the closing `Both histories drop these dates before diffing.` line)
  - Renumber `## Allowance 3` → `## Allowance 2`
  - In the "What the test enforces" section, the prose says "After applying the three allowances" — change to "After applying the two allowances"

- [ ] **Step 4:** Run full suite.

```bash
npm test
```

- [ ] **Step 5:** Commit.

```bash
git add parity/src/parity.test.ts docs/specs/2026-05-02-v0.4-parity-divergences.md
git commit -m "test(parity): drop CALENDAR_IGNORE — NYSEExchangeCalendar fixes the 3 dates"
```

---

### Task 13 — Mark old plan superseded; update top-level docs

**Goal:** Leave a breadcrumb so anyone reading the deferred-plan brainstorm gets pointed at the actual implementation.

**Files:**
- Modify: `docs/plans/2026-05-02-nyse-calendar.md` (add supersede header)
- Modify: `docs/AGENTS.md` (update calendar bullet)

**Acceptance Criteria:**
- [ ] First line of `docs/plans/2026-05-02-nyse-calendar.md` reads `> **Superseded by `docs/plans/2026-05-02-calendars-module.md`** (broader scope: framework + NYSE + LSE).` — leave the rest of the file as historical record
- [ ] `docs/AGENTS.md`'s reference to the old plan is replaced by a reference to the new plan + spec pair
- [ ] No other docs touched

**Verify:** `grep -n "2026-05-02-calendars-module" docs/AGENTS.md docs/plans/2026-05-02-nyse-calendar.md` → both files match

**Steps:**

- [ ] **Step 1:** Prepend to `docs/plans/2026-05-02-nyse-calendar.md` (first line, before existing `# NYSE Calendar` heading):

```markdown
> **Superseded by [`docs/plans/2026-05-02-calendars-module.md`](2026-05-02-calendars-module.md)** (broader scope: framework + NYSE + LSE). Companion spec: [`docs/specs/2026-05-02-calendars-module-design.md`](../specs/2026-05-02-calendars-module-design.md). Original brainstorm preserved below for historical context.

```

- [ ] **Step 2:** Edit `docs/AGENTS.md` line 36 (the `plans/2026-05-02-nyse-calendar.md captures decisions for the deferred NYSE calendar port` bullet). Replace with:

```markdown
`plans/2026-05-02-calendars-module.md` (companion spec `specs/2026-05-02-calendars-module-design.md`) — multi-exchange calendar framework: `ExchangeCalendar` base + `NYSEExchangeCalendar` + `LSEExchangeCalendar`. Supersedes the deferred `plans/2026-05-02-nyse-calendar.md` brainstorm.
```

- [ ] **Step 3:** Verify and commit.

```bash
grep -n "2026-05-02-calendars-module" docs/AGENTS.md docs/plans/2026-05-02-nyse-calendar.md
git add docs/AGENTS.md docs/plans/2026-05-02-nyse-calendar.md
git commit -m "docs(calendars): supersede deferred NYSE-calendar plan; update docs/AGENTS"
```

---

## Final verification

After Task 13:

```bash
npm test                                                             # sdk + parity green
npx tsc --noEmit                                                     # type-clean
grep -rn "USEquityCalendar\|us-equity-calendar" src/ parity/ scripts/ docs/ --exclude="2026-05-02-nyse-calendar.md"
# expected: empty
grep -rn "CALENDAR_IGNORE" parity/                                   # expected: empty
```

The branch is then ready to merge into `main` along with the rest of `feat/v0.4`.
