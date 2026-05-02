# NYSE Calendar — port `pandas_market_calendars`

**Status:** Deferred until after phase 6 (codemod). Brainstorm captured 2026-05-02; no implementation work yet.

**Why this exists:** `src/reference/us-equity-calendar.ts` has three bugs that the v0.4 parity test ignores via `CALENDAR_IGNORE = {2020-06-19, 2021-06-18, 2021-12-31}` (see `docs/specs/2026-05-02-v0.4-parity-divergences.md` § Allowance 2). The calendar will be replaced by a faithful port of `pandas_market_calendars` (https://github.com/rsheftel/pandas_market_calendars), starting with NYSE only.

## Why deferred

Phase 6 (v0.3 → `tactical/v1` codemod) is more load-bearing — it unblocks v0.4 adoption and the eventual public API switch. The calendar bugs affect 3 dates out of 1146 trading days in the parity range, fully documented and codified, with no impact on functional correctness for the parity-tested strategy. Sequence:

1. Phase 6 codemod
2. Public API switch in `src/index.ts`
3. **NYSE calendar port (this plan)**
4. Intraday execution support (which the new calendar enables)

## Decisions already made (do not re-litigate)

### Interface shape: widen `Calendar` directly

Current `src/interfaces/calendar.ts`:

```ts
export interface Calendar {
  isOpen(t: Date): boolean;
  next(t: Date): Date;
  previous(t: Date): Date;
  sessions(range: DateRange): ReadonlyArray<Date>;
}
```

Widen to add session-time methods on the same interface (do **not** introduce a separate `MarketCalendar extends Calendar` layer):

```ts
export interface Calendar {
  isOpen(t: Date): boolean;
  next(t: Date): Date;
  previous(t: Date): Date;
  sessions(range: DateRange): ReadonlyArray<Date>;
  // new in this plan
  schedule(range: DateRange): ReadonlyArray<Session>;  // {date, open, close}
  isEarlyClose(t: Date): boolean;
}
```

**Rationale:** `pandas_market_calendars` itself uses a single `MarketCalendar` base class — no narrower interface. Date-only consumers call `valid_days()`, intraday consumers call `schedule()`, both live on the same class. NYSE extends via plain single inheritance. We mirror that. YAGNI says don't split until a second consumer wants the narrow contract.

`class NYSECalendar implements Calendar` is the public API.

### Scope: full port, NYSE only

- Session days **and** session times (open 09:30 ET, close 16:00 ET).
- Early closes — half-days at 13:00 ET (day after Thanksgiving, day before Christmas, day before July 4 when applicable).
- Historical-onset rules — Juneteenth from 2022, MLK from 1998, etc.
- Adhoc closures — 9/11/2001, Hurricane Sandy 2012, presidential funerals (GHWB, Reagan, Nixon, Truman), etc.
- Time zone awareness (NYSE = America/New_York). TZ-handling decision deferred to plan-writing time; tentatively prefer plain UTC + offset over a `luxon`/`date-fns-tz` dep, but revisit.

**Out of scope for v1:** intraday breaks (NYSE has none), other exchanges (LSE/CME/etc.), pre-1985 close-time changes (NYSE only — and the parity test's earliest fixture is 2020-06).

### Holiday encoding: code-driven with onset rules

No port of `pandas.tseries.holiday`'s `AbstractHolidayCalendar` DSL. Rules stay code-driven (current `USEquityCalendar` style — `nthWeekdayOfMonth`, `lastWeekdayOfMonth`, `easter`), but each rule carries `validFrom?: number` / `validUntil?: number` year bounds. Adhoc closures as a literal `Set<string>` of `'YYYY-MM-DD'`.

**Rationale:** A holiday-rule DSL is over-engineering for one exchange. When LSE/CME show up, we extract the DSL mechanically. The structural mirror to `pandas_market_calendars` is the *class shape* (one base, plain subclass), not the *holiday machinery*.

## Open questions for the implementation plan

1. **TZ handling.** Plain UTC + ET-offset arithmetic is workable for NYSE (no DST issues for *date* boundaries since NYSE is always ET). Session-time methods need actual TZ-aware timestamps. Decide: hand-rolled DST table, `Intl.DateTimeFormat` tricks, or a 1-dep solution (`luxon`/`date-fns-tz`)?
2. **Migration of `USEquityCalendar`.** Replace in place (rename file/class to `nyse-calendar.ts` / `NYSECalendar`), or keep both during a deprecation cycle? Current callers: `runBacktest`, `BacktestExecutor`, `tactical/fromSpec`, indicator/sync handles, several integration tests. Replace-in-place is fine — no public-API consumers since v0.4 isn't re-exported yet.
3. **Parity test.** Once shipped, drop `CALENDAR_IGNORE` from `parity/src/parity.test.ts` and remove Allowance 2 from the divergences spec. Verify the gate still passes (it should — the dates the old calendar was wrong on are the only ones masked).

## Reference

- Source: `pandas_market_calendars/market_calendar.py` (1055 lines, single concrete-but-abstract base via `ABCMeta`); `pandas_market_calendars/calendars/nyse.py` (NYSE-specific overrides).
- Two abstract members only: `name`, `tz`. Everything else has concrete defaults — subclasses override the bits they care about (`regular_holidays`, `adhoc_holidays`, `special_closes`, `weekmask`, etc.).
- `valid_days(start, end) → DatetimeIndex` — date-only.
- `schedule(start, end) → DataFrame` — TZ-aware open/close timestamps per valid day, applies special closes/opens.
