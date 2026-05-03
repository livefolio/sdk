import type { Calendar, Session } from '../interfaces/calendar';
import type { DateRange } from '../interfaces/types';

const MS_PER_DAY = 86_400_000;

function midnightUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * 24/7 calendar where every day is a single session running midnight UTC to
 * the next midnight UTC. Suitable for crypto strategies (BTC, ETH) and any
 * always-on market.
 *
 * - `isOpen(t)` always returns `true`.
 * - `next(t)` returns midnight UTC of the day after `t`.
 * - `previous(t)` returns midnight UTC of the day before `t`.
 * - `sessions(range)` returns one Date per day in `[range.from, range.to)`.
 * - `schedule(range)` returns full Sessions with `open`/`close` at midnight UTC.
 * - `isEarlyClose(t)` always returns `false`.
 */
export class Crypto24x7Calendar implements Calendar {
  isOpen(_t: Date): boolean {
    return true;
  }

  next(t: Date): Date {
    return new Date(midnightUtc(t).getTime() + MS_PER_DAY);
  }

  previous(t: Date): Date {
    return new Date(midnightUtc(t).getTime() - MS_PER_DAY);
  }

  sessions(range: DateRange): ReadonlyArray<Date> {
    const out: Date[] = [];
    let cursor = midnightUtc(range.from);
    const end = range.to.getTime();
    while (cursor.getTime() < end) {
      out.push(cursor);
      cursor = new Date(cursor.getTime() + MS_PER_DAY);
    }
    return out;
  }

  schedule(range: DateRange): ReadonlyArray<Session> {
    return this.sessions(range).map((date) => ({
      date,
      open: date,
      close: new Date(date.getTime() + MS_PER_DAY),
    }));
  }

  isEarlyClose(_t: Date): boolean {
    return false;
  }
}
