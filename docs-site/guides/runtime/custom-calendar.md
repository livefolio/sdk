# Custom Calendar

A `Calendar` is the SDK's single source of truth for trading-day arithmetic. The backtest engine consults it to determine which days are sessions, when sessions open and close, and how to advance from one trading day to the next. Two reference implementations ship with the SDK (`NYSEExchangeCalendar`, `LSEExchangeCalendar`). This page covers the interface contract and both paths to writing your own: implementing `Calendar` from scratch for always-open venues, or subclassing `ExchangeCalendar` for regulated exchanges.

## Contract

The [`Calendar`](/api/interfaces/Calendar) interface has six methods:

```ts
interface Calendar {
  isOpen(t: Date): boolean;
  next(t: Date): Date;
  previous(t: Date): Date;
  sessions(range: DateRange): ReadonlyArray<Date>;
  schedule(range: DateRange): ReadonlyArray<Session>;
  isEarlyClose(t: Date): boolean;
}
```

### Method invariants

| Method | Invariant |
|---|---|
| `isOpen(t)` | Returns `true` only when `t` is strictly inside a session: `[session.open, session.close)` |
| `next(t)` | Returns the midnight-UTC `Date` of the next trading day **strictly after** `t`. Never returns a holiday or weekend. |
| `previous(t)` | Symmetric inverse of `next`. |
| `sessions(range)` | Ascending array of midnight-UTC `Date` values for every trading day in `[range.from, range.to)`. |
| `schedule(range)` | Same dates as `sessions` plus `open` / `close` UTC instants per session. |
| `isEarlyClose(t)` | `true` if the session containing `t` ends before the exchange's normal close time. |

**UTC-midnight convention.** `next`, `previous`, and the `date` field of `Session` must all be midnight-UTC `Date` objects (e.g. `new Date('2024-06-03T00:00:00.000Z')`). The engine uses these as stable keys for session lookup.

## Path A: implement `Calendar` from scratch

Use this path for venues with no concept of holidays, exchange hours, or weekends — most commonly, crypto markets.

```ts
class Crypto24x7Calendar implements Calendar {
  isOpen(_t: Date): boolean { return true; }

  next(t: Date): Date {
    return new Date(midnightUTC(t).getTime() + MS_DAY);
  }

  previous(t: Date): Date {
    return new Date(midnightUTC(t).getTime() - MS_DAY);
  }

  sessions(range: DateRange): ReadonlyArray<Date> {
    const out: Date[] = [];
    let d = midnightUTC(range.from);
    while (d.getTime() < midnightUTC(range.to).getTime()) {
      out.push(d);
      d = new Date(d.getTime() + MS_DAY);
    }
    return out;
  }

  schedule(range: DateRange): ReadonlyArray<Session> {
    return this.sessions(range).map(date => ({
      date,
      open: date,
      close: new Date(date.getTime() + MS_DAY),
    }));
  }

  isEarlyClose(_t: Date): boolean { return false; }
}
```

## Path B: subclass `ExchangeCalendar`

[`ExchangeCalendar`](/api/classes/ExchangeCalendar) is an abstract base that provides all six `Calendar` methods. You override only the hooks that describe your exchange's rules. It uses [luxon](https://moment.github.io/luxon/) internally to convert local open/close times to UTC, so you must set `this.tz` to an IANA timezone name.

The nine overridable hooks (all have no-op / sensible defaults):

| Hook | Purpose | Default |
|---|---|---|
| `regularHolidays()` | `HolidayRule[]` — recurrence-based full-day closures | `[]` |
| `adhocHolidays()` | `Set<string>` of literal `'YYYY-MM-DD'` closures | `new Set()` |
| `specialCloses()` | `SpecialClose[]` — recurrence-based early-close rules | `[]` |
| `specialClosesAdhoc()` | `Map<string, TimeOfDay>` of literal early closes | `new Map()` |
| `specialOpens()` | `SpecialOpen[]` — recurrence-based late-open rules | `[]` |
| `specialOpensAdhoc()` | `Map<string, TimeOfDay>` of literal late opens | `new Map()` |
| `regularOpen(date)` | Default session open time | `{ h: 9, m: 30 }` |
| `regularClose(date)` | Default session close time | `{ h: 16, m: 0 }` |
| `weekmask(date)` | `Set<number>` of active JS weekday numbers (0=Sun…6=Sat) | `{1,2,3,4,5}` (Mon-Fri) |

For both `specialCloses` and `specialOpens`: adhoc overrides win over rule-driven overrides, and both win over the `regular*` hooks.

A minimal subclass with no holidays and standard Mon–Fri hours:

```ts
import { ExchangeCalendar } from '@livefolio/sdk';

class SimpleExchangeCalendar extends ExchangeCalendar {
  readonly name = 'SIMPLE';
  readonly tz   = 'Europe/London';
  // All hooks retain their defaults — Mon-Fri, 09:30–16:00 local time.
}
```

To add Good Friday and Christmas Day as holidays:

```ts
import { ExchangeCalendar, nearestWorkday } from '@livefolio/sdk';
import type { HolidayRule } from '@livefolio/sdk';

class MyExchangeCalendar extends ExchangeCalendar {
  readonly name = 'MY';
  readonly tz   = 'Europe/Paris';

  protected override regularHolidays(): ReadonlyArray<HolidayRule> {
    return [
      { name: 'Good Friday', resolve: (y) => easterPlus(y, -2) },
      { name: 'Christmas', resolve: (y) => nearestWorkday(new Date(Date.UTC(y, 11, 25))) },
    ];
  }
}
```

See `src/calendars/nyse.ts` for a complete production example with adhoc holidays, early closes, variable session times across eras, and a variable weekmask.

## TZ handling

`ExchangeCalendar` stores `this.tz` (e.g. `'America/New_York'`) and uses luxon's `DateTime.fromObject({…}, { zone: this.tz })` to convert `{ h, m }` local times to UTC instants. When implementing `Calendar` from scratch, you are responsible for the conversion. Return UTC-midnight Dates from `next` and `previous`, and UTC instants from `Session.open` / `Session.close`.

## Sample: `Crypto24x7Calendar`

The full runnable sample is at `scripts/docs/guides-runtime/custom-calendar.ts`:

```sh
npx tsx scripts/docs/guides-runtime/custom-calendar.ts
```

<<< @/../scripts/docs/guides-runtime/custom-calendar.ts

## Things to verify

- [ ] `next(t)` never returns `t` itself — it must strictly advance.
- [ ] `sessions(range)` respects the half-open interval: includes `range.from`, excludes `range.to`.
- [ ] `previous(next(t))` equals `t` for any trading day `t` (round-trip property).
- [ ] `isOpen` returns `false` for dates that are holidays or weekends.
- [ ] All dates returned by `next`/`previous`/`sessions` are midnight-UTC (`getUTCHours() === 0`).
- [ ] Your implementation compiles: `npm run docs:check`.
- [ ] Integration: call `calendar.sessions(range)` directly to inspect the session count before wiring into a backtest.

## What's next

- **DataFeed alignment** — ensure your `DataFeed` only yields bars on days your calendar considers open. A mismatch causes the engine to skip bars or attempt indicator calculations on sparse data.
- **`BacktestExecutor`** needs a `Calendar` for next-session resolution. Pass the same instance to both. See [Custom Executor](./custom-executor).
- **API reference** — [`Calendar`](/api/interfaces/Calendar) · [`ExchangeCalendar`](/api/classes/ExchangeCalendar) · [`NYSEExchangeCalendar`](/api/classes/NYSEExchangeCalendar) · [`LSEExchangeCalendar`](/api/classes/LSEExchangeCalendar).
