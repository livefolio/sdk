<!-- Parent: ../AGENTS.md -->

# src/calendars

## Purpose
Multi-exchange calendar framework. `ExchangeCalendar` is the abstract base; per-exchange classes (`NYSEExchangeCalendar`, `LSEExchangeCalendar`) override hooks for holidays, adhoc closures, special closes, and session times. Mirrors `pandas_market_calendars`'s class shape.

## Key Files

| File | Description |
|------|-------------|
| `exchange-calendar.ts` | `abstract class ExchangeCalendar implements Calendar` — shared scheduling/holiday/observance/TZ logic. Subclasses provide `name`, `tz`, and override 9 hooks: `regularHolidays`, `adhocHolidays`, `specialCloses`, `specialClosesAdhoc`, `specialOpens`, `specialOpensAdhoc`, `regularOpen(date)`, `regularClose(date)`, `weekmask(date)` |
| `holiday-rules.ts` | Types: `HolidayRule`, `SpecialClose`, `SpecialOpen`, `AdhocTimeOverrides`, `SessionTimeRule`, `TimeOfDay`. Date helpers: `nthWeekdayOfMonth`, `lastWeekdayOfMonth`, `easter`, `observed`, `nearestWorkday`, `sundayToMonday`, `firstMondayOnOrAfter`, `easterPlus`, `dropIfNotInDays`. Resolvers: `resolveHolidays`, `resolveSpecialCloses`, `resolveSpecialOpens`, `resolveSessionTime` |
| `nyse.ts` | `NYSEExchangeCalendar` — full faithful port (Juneteenth from 2022, MLK from 1998, adhoc closures, early closes) |
| `lse.ts` | `LSEExchangeCalendar` — UK bank holidays, Europe/London, early closes Christmas Eve and NYE 12:30 |
| `get-calendar.ts` | `getCalendar('NYSE' \| 'LSE')` registry; exports `ExchangeName` union type |
| `index.ts` | Barrel — re-exports `ExchangeCalendar`, `NYSEExchangeCalendar`, `LSEExchangeCalendar`, `getCalendar`, `ExchangeName`, and types `HolidayRule`, `SpecialClose`, `SpecialOpen`, `AdhocTimeOverrides` |

## For AI Agents

### Working In This Directory
- Adding a new exchange? Create `src/calendars/<short-name>.ts`, extend `ExchangeCalendar`, add to `getCalendar`'s union, export from `index.ts` and `src/index.ts`
- Holiday rules with onset years use `validFrom`/`validUntil` — don't bake "year zero" defaults
- TZ-aware session times go through `luxon`; the public `Calendar` API stays free of luxon types
- The `Calendar` interface is the public contract. `ExchangeCalendar` is one implementation family — crypto/composite/test calendars implement `Calendar` directly without going through this base class
