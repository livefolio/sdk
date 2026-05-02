# Calendars Module — Design

**Status:** Spec for the implementation plan at `docs/plans/2026-05-02-calendars-module.md`.

**Supersedes:** `docs/plans/2026-05-02-nyse-calendar.md` (brainstorm-only; widened scope from "NYSE port" to "calendars framework + NYSE + LSE").

## Goal

Replace the buggy `USEquityCalendar` with a multi-exchange calendar framework that mirrors `pandas_market_calendars`'s class shape: a single `ExchangeCalendar` abstract base implementing the public `Calendar` interface, with per-exchange subclasses (`NYSEExchangeCalendar`, `LSEExchangeCalendar`) overriding hooks for holidays, adhoc closures, special closes, special opens, weekmask, and era-varying session times. Widen `Calendar` with session-time methods (`schedule`, `isEarlyClose`) so the contract is intraday-ready when intraday execution support eventually lands. **Both per-exchange ports are fully faithful to the upstream Python implementation**, including all historical adhoc closures (NYSE back to 1885, LSE back to 1801), era-varying session times (NYSE: 10:00–15:00 pre-1952, 10:00–15:30 to 1973, 10:00–16:00 to 1985, 9:30–16:00 thereafter), pre-1952 NYSE Saturday trading, and royal/jubilee/coronation closures for LSE.

## Why

- `USEquityCalendar` has three documented bugs (Juneteenth observed from year zero; Dec 31 wrongly closed when Jan 1 falls on a Saturday) that the parity gate masks via `CALENDAR_IGNORE = {2020-06-19, 2021-06-18, 2021-12-31}`. Allowance 2 of `docs/specs/2026-05-02-v0.4-parity-divergences.md` exists only to cover for this.
- The current `Calendar` interface is date-only. Adding session-time methods now (with two real consumers — NYSE and LSE — exercising them) avoids a speculative-API problem and unblocks the deferred intraday work.
- Multi-exchange is genuinely useful (UK-listed dual-listings, European strategies). Designing the abstraction with a second concrete consumer present is the only way to extract the right shape — pandas_market_calendars's structure (one class, two abstract members `name`/`tz`, concrete defaults everywhere else) is directly portable and battle-tested.

## Decisions (locked in)

### 1. Interface widening, not interface fork

`Calendar` is widened in place. There is **no separate `MarketCalendar`/`ExchangeCalendar` interface layer.** The implementation hierarchy is layered (`ExchangeCalendar` abstract class implements `Calendar`), but the contract stays single. Rationale: pandas_market_calendars itself uses a single `MarketCalendar` base class — date-only consumers call `valid_days()`, intraday consumers call `schedule()`, both live on the same class. We mirror that. YAGNI: don't fork interfaces until a second consumer wants the narrow contract.

```ts
// src/interfaces/calendar.ts
export interface Calendar {
  isOpen(t: Date): boolean;
  next(t: Date): Date;
  previous(t: Date): Date;
  sessions(range: DateRange): ReadonlyArray<Date>;
  // new in this spec
  schedule(range: DateRange): ReadonlyArray<Session>;
  isEarlyClose(t: Date): boolean;
}

export type Session = { date: Date; open: Date; close: Date };
export type TimeOfDay = { h: number; m: number };
```

`Session` is a single open/close interval per day. Multi-interval sessions (HKEX lunch break, CME 23-hour) are deferred until a third exchange forces the change. When that happens, `schedule()`'s return shape will widen, not get a sibling method.

### 2. New module, not under `reference/`

The calendar subsystem has outgrown "one reference impl in a folder of reference impls" (it's a base class + rule DSL + multi-exchange registry + TZ machinery — a different shape from `MemoryFeatureCache` and `BacktestExecutor`, which are single-file with no hierarchy). It moves to `src/calendars/` (plural, mirrors `src/features/`). `MemoryFeatureCache` and `BacktestExecutor` stay in `src/reference/`.

### 3. Class hierarchy

```
Calendar (interface, src/interfaces/calendar.ts)
  ├─ ExchangeCalendar (abstract class, src/calendars/exchange-calendar.ts)
  │    ├─ NYSEExchangeCalendar (src/calendars/nyse.ts)
  │    └─ LSEExchangeCalendar  (src/calendars/lse.ts)
  └─ (future: CryptoCalendar, FakeCalendar, composite calendars implement Calendar directly)
```

`ExchangeCalendar` has two abstract members (`name`, `tz`) and concrete-overridable hooks for everything else. Subclasses override `regularHolidays()`, `adhocHolidays()`, `specialCloses()`, `regularOpen()`, `regularClose()`, `weekmask()`. Mirrors pandas_market_calendars exactly.

### 4. Holiday-rule encoding: code-driven with year bounds

No DSL. Rules stay code-driven (current `USEquityCalendar` style — `nthWeekdayOfMonth`, `lastWeekdayOfMonth`, `easter`), promoted from `us-equity-calendar.ts` to a shared `src/calendars/holiday-rules.ts`. Each rule carries optional `validFrom?: number` / `validUntil?: number` year bounds — used heavily for historical onset/sunset (e.g. NYSE's Juneteenth has `validFrom: 2022`, MLK has `validFrom: 1998`, Lincoln's Birthday has `validUntil: 1953`, Washington's Birthday fixed-Feb-22 has `validUntil: 1970` then nthWeekday version has `validFrom: 1971`).

```ts
export type HolidayRule = {
  name: string;
  /** Returns the holiday date for the given year, or null if the rule does not apply. */
  resolve: (year: number) => Date | null;
  validFrom?: number;
  validUntil?: number;
  /** If true, the date is shifted to the nearest weekday when it falls on a weekend. */
  observe?: boolean;
};
```

Adhoc closures (NYSE: 9/11, Hurricane Sandy, ALL presidential funerals back to Garfield 1881, weather closures, 1914 WWI shutdown, paperwork-crisis Wednesdays 1968, etc. — LSE: Queen Elizabeth II's funeral 2022, royal weddings, jubilees, coronations, Millennium Eve) are a literal `ReadonlySet<string>` of `'YYYY-MM-DD'`. Volume is fine — set lookup is O(1) regardless of how many entries.

### 5. Special closes / special opens (early-close, late-open days)

```ts
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
```

Plus literal-list variants for one-off historical overrides that don't fit a year-derived rule:

```ts
/** Map of YYYY-MM-DD → override time. Used for one-off historical specials. */
export type AdhocTimeOverrides = ReadonlyMap<string, TimeOfDay>;
```

Subclasses expose: `specialCloses()`, `specialClosesAdhoc()`, `specialOpens()`, `specialOpensAdhoc()`. Resolution order: rule-based first, then adhoc map (adhoc wins on conflict — matches pandas_market_calendars).

NYSE rule-based: day-after-Thanksgiving (13:00 ET, `validFrom: 1992`), Christmas Eve when on weekday (13:00 ET, `validFrom: 1996`), July 3 when July 4 is on weekday (13:00 ET, various era rules).
NYSE adhoc closes (literal): early closes for paperwork-crisis Wednesdays in 1968, 1929 crash days, dozens of historical 14:00/12:00/14:30 closes.
LSE rule-based: Christmas Eve (12:30 London), New Year's Eve (12:30 London).
LSE adhoc: pre-decimalisation early closes, special trading-half-day overrides.

### 5a. Era-varying session times

`regularOpen`/`regularClose` take a date so they can vary by era. Default returns a single fixed time (subclass with constant sessions doesn't have to do anything different from before). Historical exchanges return different times based on the date.

```ts
protected regularOpen(date: Date): TimeOfDay { return { h: 9, m: 30 }; }
protected regularClose(date: Date): TimeOfDay { return { h: 16, m: 0 }; }
```

NYSE example (verbatim from upstream):
- `market_open`: 10:00 default → 09:30 from 1985-09-30
- `market_close`: 15:00 default → 15:30 from 1952-09-29 → 16:00 from 1974-01-02

Internal helper `resolveSessionTime(rules, date)` does the lookup over an array of `{ effectiveFrom?: 'YYYY-MM-DD'; time: TimeOfDay }` rules, picking the latest rule with `effectiveFrom ≤ date`. Subclasses can use this helper or hand-roll the cascade.

### 5b. Variable weekmask (Saturday trading)

`weekmask` takes a date so it can vary by era. NYSE traded Mon–Sat through 1952-09-29; from 1952-09-29 onward, Mon–Fri.

```ts
protected weekmask(date: Date): ReadonlySet<number> { return new Set([1, 2, 3, 4, 5]); }
```

NYSE override returns `{1..6}` for dates before 1952-09-29 and `{1..5}` from then on. Saturday session times pre-1952 differ from weekday session times — this is handled by overriding `regularOpen(date)` / `regularClose(date)` to branch on `date.getUTCDay() === 6`. (Not pretty, but clearer than another framework hook for one historical wrinkle.)

### 6. Timezone handling: `luxon`

Add `luxon` (`^3.x`) + `@types/luxon` as runtime dependencies. Hand-rolled DST tables for two timezones is past the break-even point; pandas_market_calendars relies on `pytz` for the same reason. `luxon` is the smallest reasonable TZ-aware option in the JS ecosystem (smaller than `moment-timezone`, simpler than `@js-joda`).

`schedule()` uses `DateTime.fromObject({ year, month, day, hour, minute }, { zone: this.tz })` to construct localized session boundaries, then converts to native `Date` (UTC instant) for the public API. The `Calendar` interface itself stays free of luxon types — the dep is internal to `ExchangeCalendar`.

### 7. Registry

```ts
// src/calendars/get-calendar.ts
export type ExchangeName = 'NYSE' | 'LSE';
export function getCalendar(name: ExchangeName): ExchangeCalendar;
```

Mirrors pandas_market_calendars's `get_calendar`. Returns a fresh instance per call (subclasses are cheap to instantiate; per-year caches inside the instance handle the only meaningful work).

### 8. File names: short

Match upstream's per-exchange short file convention: `nyse.ts`, `lse.ts` (not `nyse-exchange-calendar.ts`). The exported class is `NYSEExchangeCalendar`. Disambiguating qualifier lives in the class name; the file path is uncluttered.

### 9. Replace `USEquityCalendar` outright

`src/reference/us-equity-calendar.ts` is deleted, not aliased. Rationale: v0.4 isn't published yet (`feat/v0.4`), there are no external consumers, and keeping an alias would create a confusing "which one do I import?" question. The codemod is small (8 call sites: 5 in `src/`, 1 reference test, 2 in `parity/`). After the swap, `CALENDAR_IGNORE` is dropped from `parity/src/parity.test.ts` and Allowance 2 is removed from `docs/specs/2026-05-02-v0.4-parity-divergences.md`.

## Historical-port scope (in scope, distinct from out-of-scope)

For both NYSE and LSE, the port is **fully faithful** to upstream:
- All adhoc closures (NYSE: every entry from `pandas_market_calendars/holidays/nyse.py` back to 1885 — Garfield/McKinley/Harding/FDR/JFK funerals, 1888 blizzard, 1914 WWI shutdown, 1929 crash days, 1968 paperwork-crisis Wednesdays, 1977 NYC blackout, 1985 Hurricane Gloria, 1996 blizzard, 9/11 + reopen days, Hurricane Sandy 2012, recent funerals; LSE: every royal/state event in upstream).
- All era-varying holiday onset/sunset (Lincoln's Birthday `validUntil: 1953`, Election Day `validUntil: 1969` then sporadic, Veterans/Armistice Day eras, Columbus Day `validUntil: 1953`, Washington's Birthday fixed-Feb-22 → Monday-Holiday-Act 1971, Memorial Day fixed-May-30 → Monday-Holiday-Act 1971, etc.).
- Era-varying session times (NYSE 10:00 → 09:30 in 1985; close 15:00 → 15:30 in 1952 → 16:00 in 1974).
- Variable weekmask (NYSE Mon–Sat through 1952-09-29).
- LSE royal events: Coronations (Elizabeth II 1953, Charles III 2023), Royal Weddings (Charles+Diana 1981, William+Kate 2011), Jubilees (Silver 1977, Golden 2002, Diamond 2012, Platinum 2022), state funerals (Queen Elizabeth II 2022, Churchill 1965), Millennium Eve 1999-12-31.
- LSE pre-1971 era (before the Banking and Financial Dealings Act 1971 — bank holidays were ad hoc royal proclamations).

Test coverage is **representative** rather than exhaustive: ≥1 spot-check per era and per category (modern holidays, historical onset/sunset, adhoc closures pre-WWI, mid-century, modern, era-varying session times, Saturday trading, royal events). The data file itself is the source of truth — tests verify the loader works correctly and the headline dates match.

## Out of scope

- **Third+ exchange** (TSX, CME, HKEX, JPX, Euronext, etc.). Add when there's a real strategy that needs it.
- **Multi-interval session structure** (lunch breaks, intraday breaks, multiple sessions per day for futures). The HKEX/JPX/CME consumer that triggers this work will also drive the right shape change to `Session` and `schedule()`.
- **Holiday-rule DSL** (`AbstractHolidayCalendar` style). Even with the historical port we use code-driven rules — the rule density is high but the rule shapes are simple (`nthWeekday`, `lastWeekday`, fixed-date, easter-relative). Porting `pandas.tseries.holiday`'s DSL is more work than just writing the rules.
- **Pre-1885 NYSE history** (NYSE existed from 1792). pandas_market_calendars itself doesn't go before 1885; we follow that floor.
- **Pre-1801 LSE history** (LSE chartered 1801). Same — follow upstream's floor.
- **Saturday-specific session times pre-1887 NYSE.** Pre-1887 Saturday close was 12:00 (vs 13:00 winter / 12:00 summer 1887–1952). We approximate with the 1887–1952 winter rule for all Saturdays before 1952-09-29; not material for any practical use.
- **Intraday execution support in `runBacktest`.** Calendar gains the *primitives* here, but no engine changes ship in this plan.
- **Crypto / 24-7 / composite calendars.** Future work; the interface stays open to them since they implement `Calendar` directly without going through `ExchangeCalendar`.

## Public API additions

After this plan lands, `src/index.ts` exports:

```ts
// removed: USEquityCalendar
export {
  ExchangeCalendar,
  NYSEExchangeCalendar,
  LSEExchangeCalendar,
  getCalendar,
} from './calendars';
export type {
  ExchangeName,
  HolidayRule,
  SpecialClose,
  SpecialOpen,
  AdhocTimeOverrides,
  Session,        // re-export from interfaces
  TimeOfDay,      // re-export from interfaces
} from './calendars';
```

`Calendar` interface re-export already exists; no change there other than the widened shape.

## Acceptance

- `npm test` (sdk + parity) green.
- `parity/src/parity.test.ts` green **without** `CALENDAR_IGNORE`.
- `docs/specs/2026-05-02-v0.4-parity-divergences.md` no longer contains "Allowance 2".
- `grep -rn "USEquityCalendar\|us-equity-calendar" src/ parity/ scripts/ docs/` returns nothing.
- `src/index.ts` exports `ExchangeCalendar`, `NYSEExchangeCalendar`, `LSEExchangeCalendar`, `getCalendar`.
- `NYSEExchangeCalendar` correctly handles the three previously-buggy dates (`2020-06-19` open, `2021-06-18` open, `2021-12-31` open) AND representative historical dates per era:
  - **Pre-1900:** Garfield funeral 1881-09-26 closed; 1888 blizzard 1888-03-12, 13 closed
  - **WWI:** 1914-07-31 through 1914-12-11 closed (war shutdown)
  - **Inter-war:** Bank holidays 1933-03-04 through 1933-03-14 closed (FDR)
  - **Mid-century:** Saturday trading — `cal.isOpen(1950-06-10)` (Saturday) = true; `cal.isOpen(1953-06-13)` (Saturday) = false
  - **JFK era:** 1963-11-25 closed (JFK funeral); 1968 paperwork-crisis Wednesdays (1968-06-12, etc.) closed
  - **Modern:** 9/11 + reopen days, Hurricane Sandy 2012-10-29/30, GHWB funeral 2018-12-05
  - **Session-time eras:** `cal.schedule({ from: 1950-06-12, to: 1950-06-13 })[0].close` = 15:00 ET; `1973-06-12` close = 15:30 ET; `1985-09-30` open = 09:30 ET (transition day); `2024-06-03` close = 16:00 ET
- `LSEExchangeCalendar` correctly handles representative LSE historical dates:
  - **Royal weddings:** 1981-07-29 (Charles+Diana) closed; 2011-04-29 (William+Kate) closed
  - **Coronations:** 1953-06-02 (Elizabeth II) closed; 2023-05-08 (Charles III) closed
  - **Jubilees:** 1977-06-07 (Silver), 2002-06-03 (Golden), 2012-06-05 (Diamond), 2022-06-03 (Platinum)
  - **State funerals:** 2022-09-19 (Queen Elizabeth II) closed; 1965-01-30 (Churchill) closed
  - **Millennium Eve:** 1999-12-31 closed
