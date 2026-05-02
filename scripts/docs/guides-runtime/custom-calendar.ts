// Custom Calendar — guide sample
// Demonstrates two approaches:
//   (a) Implementing Calendar from scratch for a 24x7 crypto market.
//   (b) Subclassing ExchangeCalendar for a regulated exchange.
//
//   npx tsx scripts/docs/guides-runtime/custom-calendar.ts

import { fromSpec, runBacktest, FeatureRuntime, MemoryFeatureCache, BacktestExecutor } from '@livefolio/sdk';
import type { Calendar, Session, DateRange, DataFeed, Asset, Bar, Frequency, TacticalSpec } from '@livefolio/sdk';

// ─── Approach (a): Calendar from scratch for a 24x7 market ──────────────────
//
// Crypto exchanges never close. Every calendar day is a session. There are no
// weekends, no holidays, no early closes. `next` / `previous` simply step
// one day forward or back. `isOpen` always returns true.
//
// Contract checklist:
//   - next(t) / previous(t) return midnight-UTC Dates
//   - sessions(range) is ascending, half-open [range.from, range.to)
//   - schedule(range) returns Session objects with open / close UTC instants
//   - isOpen(t) true only while a session is active (here: always)
//   - isEarlyClose(t) — crypto never closes early

const MS_DAY = 86_400_000;

function midnightUTC(t: Date): Date {
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

/**
 * Crypto24x7Calendar — every day is a session, 00:00–24:00 UTC.
 * Use this as a starting point for any always-open venue.
 */
class Crypto24x7Calendar implements Calendar {
  isOpen(_t: Date): boolean {
    return true;
  }

  next(t: Date): Date {
    return new Date(midnightUTC(t).getTime() + MS_DAY);
  }

  previous(t: Date): Date {
    return new Date(midnightUTC(t).getTime() - MS_DAY);
  }

  sessions(range: DateRange): ReadonlyArray<Date> {
    const out: Date[] = [];
    let d = midnightUTC(range.from);
    const end = midnightUTC(range.to).getTime();
    while (d.getTime() < end) {
      out.push(d);
      d = new Date(d.getTime() + MS_DAY);
    }
    return out;
  }

  schedule(range: DateRange): ReadonlyArray<Session> {
    return this.sessions(range).map((date) => ({
      date,
      open: date, // 00:00 UTC
      close: new Date(date.getTime() + MS_DAY), // 24:00 UTC (= next midnight)
    }));
  }

  isEarlyClose(_t: Date): boolean {
    return false;
  }
}

// ─── Approach (b): Subclass ExchangeCalendar ─────────────────────────────────
//
// For a regulated exchange you typically want to extend ExchangeCalendar and
// override only the abstract hooks that differ from its defaults. See:
//   src/calendars/nyse.ts   — full example with holidays + special closes
//   src/calendars/lse.ts    — European exchange with different hours
//
// The 9 overridable hooks are:
//   regularHolidays()   — array of HolidayRule (recurrence-based closures)
//   adhocHolidays()     — Set<string> of literal "YYYY-MM-DD" closures
//   specialCloses()     — array of SpecialClose (early-close recurrence rules)
//   specialClosesAdhoc()— Map<string, TimeOfDay> of literal early closes
//   specialOpens()      — array of SpecialOpen (late-open recurrence rules)
//   specialOpensAdhoc() — Map<string, TimeOfDay> of literal late opens
//   regularOpen(date)   — default open time (TimeOfDay); default 09:30
//   regularClose(date)  — default close time (TimeOfDay); default 16:00
//   weekmask(date)      — Set<number> of active JS weekday numbers; default Mon-Fri
//
// ExchangeCalendar uses luxon to localise open/close times into the exchange
// timezone (this.tz). Always set `tz` to an IANA timezone name.
//
// A minimal exchange subclass — no holidays, standard Mon-Fri 09:30–16:00:
//
//   import { ExchangeCalendar } from '@livefolio/sdk';
//
//   class SimpleExchangeCalendar extends ExchangeCalendar {
//     readonly name = 'SIMPLE';
//     readonly tz   = 'Europe/London';
//   }

// ─── Drive a backtest with Crypto24x7Calendar ────────────────────────────────

const BTCUSD = { id: 'crypto:BTCUSD', symbol: 'BTCUSD' };

// Synthetic daily bars (no weekend skipping — crypto trades 7 days a week).
function makeCryptoBars(startIso: string, count: number): Bar[] {
  const bars: Bar[] = [];
  let price = 40_000;
  let t = new Date(`${startIso}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    price = price * (1 + Math.sin(i / 15) * 0.02 + 0.0005);
    bars.push({
      t: new Date(t),
      open: price * 0.999,
      high: price * 1.015,
      low: price * 0.985,
      close: price,
      volume: 50_000,
    });
    t = new Date(t.getTime() + MS_DAY);
  }
  return bars;
}

const CRYPTO_BARS = makeCryptoBars('2024-01-01', 200);

const dataFeed: DataFeed = {
  bars: async function* (asset: Asset, range: DateRange, _freq: Frequency) {
    if (asset.id !== 'crypto:BTCUSD') throw new Error(`no fixture for ${asset.id}`);
    for (const b of CRYPTO_BARS) {
      if (b.t >= range.from && b.t < range.to) yield b;
    }
  },
};

const spec: TacticalSpec = {
  kind: 'tactical/v1',
  universe: [BTCUSD],
  rebalance: { frequency: 'Weekly' },
  features: [{ id: 'btc_price', kind: 'price', asset: BTCUSD }],
  rules: { op: 'allocate', weights: { 'crypto:BTCUSD': 1.0 } },
};

const calendar = new Crypto24x7Calendar();
const featureCache = new MemoryFeatureCache();
const range: DateRange = { from: new Date('2024-02-01T00:00:00Z'), to: new Date('2024-07-01T00:00:00Z') };
const runtime = new FeatureRuntime({ dataFeed, featureCache, range, freq: '1d' });

const executor = new BacktestExecutor({
  calendar,
  nextOpen: async (asset, t) => {
    if (asset.id !== 'crypto:BTCUSD') throw new Error(`no fixture for ${asset.id}`);
    const next = CRYPTO_BARS.find((b) => b.t.getTime() > t.getTime());
    if (!next) throw new Error(`no bar after ${t.toISOString()}`);
    return { t: next.t, price: next.open };
  },
});

const strategy = fromSpec(spec, { runtime, calendar });

const result = await runBacktest({
  strategy,
  range,
  initialPortfolio: { cash: 100_000, positions: [], t: range.from },
  dataFeed,
  executor,
  calendar,
});

// Sanity-check: crypto should have a session every day in the range.
const days = calendar.sessions(range);
console.log(`Crypto24x7: sessions in range = ${days.length}`);
console.log(`Backtest snapshots            = ${result.snapshots.length}`);
console.log(`Rebalances                    = ${result.snapshots.filter((s) => s.orders.length > 0).length}`);
