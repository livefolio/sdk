import { describe, it, expect } from 'vitest';
import { LSEExchangeCalendar } from './lse';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
const cal = new LSEExchangeCalendar();
const MS_PER_DAY = 86_400_000;

function localTime(date: Date, tz: string): { h: number; m: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { h: h % 24, m };
}

function sessionFor(date: Date) {
  const sessions = cal.schedule({ from: date, to: new Date(date.getTime() + MS_PER_DAY) });
  return sessions[0];
}

describe('LSE — basic identity', () => {
  it('name is LSE', () => {
    expect(cal.name).toBe('LSE');
  });
  it('tz is Europe/London', () => {
    expect(cal.tz).toBe('Europe/London');
  });
});

describe('LSE — modern bank holidays (2024)', () => {
  it("2024-01-01 New Year's Day closed", () => {
    expect(cal.isOpen(utc('2024-01-01'))).toBe(false);
  });
  it('2024-03-29 Good Friday closed', () => {
    expect(cal.isOpen(utc('2024-03-29'))).toBe(false);
  });
  it('2024-04-01 Easter Monday closed', () => {
    expect(cal.isOpen(utc('2024-04-01'))).toBe(false);
  });
  it('2024-05-06 Early May Bank Holiday closed', () => {
    expect(cal.isOpen(utc('2024-05-06'))).toBe(false);
  });
  it('2024-05-27 Spring Bank Holiday closed', () => {
    expect(cal.isOpen(utc('2024-05-27'))).toBe(false);
  });
  it('2024-08-26 Summer Bank Holiday closed', () => {
    expect(cal.isOpen(utc('2024-08-26'))).toBe(false);
  });
  it('2024-12-25 Christmas Day closed', () => {
    expect(cal.isOpen(utc('2024-12-25'))).toBe(false);
  });
  it('2024-12-26 Boxing Day closed', () => {
    expect(cal.isOpen(utc('2024-12-26'))).toBe(false);
  });
  it('2024-06-03 (regular Monday) is OPEN', () => {
    expect(cal.isOpen(utc('2024-06-03'))).toBe(true);
  });
});

describe('LSE — Christmas / Boxing Day weekend substitutions', () => {
  // 2021: Dec 25 is Saturday → Mon Dec 27 (subst Christmas) + Tue Dec 28 (subst Boxing)
  it('2021-12-27 (Mon) — substitute Christmas closed', () => {
    expect(cal.isOpen(utc('2021-12-27'))).toBe(false);
  });
  it('2021-12-28 (Tue) — substitute Boxing Day closed', () => {
    expect(cal.isOpen(utc('2021-12-28'))).toBe(false);
  });

  // 2022: Dec 25 is Sunday → Mon Dec 26 is Boxing Day (regular) + Tue Dec 27 is substitute Christmas
  it('2022-12-26 (Mon) — Boxing Day closed', () => {
    expect(cal.isOpen(utc('2022-12-26'))).toBe(false);
  });
  it('2022-12-27 (Tue) — substitute Christmas closed', () => {
    expect(cal.isOpen(utc('2022-12-27'))).toBe(false);
  });

  // 2016: Dec 25 is Sunday, Dec 26 (Mon) substitute Christmas + Dec 27 (Tue) substitute Boxing
  it('2016-12-26 (Mon) — substitute Christmas closed', () => {
    expect(cal.isOpen(utc('2016-12-26'))).toBe(false);
  });
  it('2016-12-27 (Tue) — substitute Boxing closed', () => {
    expect(cal.isOpen(utc('2016-12-27'))).toBe(false);
  });
});

describe('LSE — VE-Day anniversaries (Early May Bank Holiday displaced)', () => {
  // 1995: regular Early May (Mon May 1) is dropped; May 8 closed instead.
  it('1995-05-01 (Mon) is OPEN — Early May removed for VE-Day 50th', () => {
    expect(cal.isOpen(utc('1995-05-01'))).toBe(true);
  });
  it('1995-05-08 (Mon) closed — VE-Day 50th anniversary', () => {
    expect(cal.isOpen(utc('1995-05-08'))).toBe(false);
  });

  // 2020: regular Early May (Mon May 4) is dropped; May 8 (Fri) closed instead.
  it('2020-05-04 (Mon) is OPEN — Early May removed for VE-Day 75th', () => {
    expect(cal.isOpen(utc('2020-05-04'))).toBe(true);
  });
  it('2020-05-08 (Fri) closed — VE-Day 75th anniversary', () => {
    expect(cal.isOpen(utc('2020-05-08'))).toBe(false);
  });
});

describe('LSE — Jubilees', () => {
  // Silver Jubilee 1977-06-07
  it('1977-06-07 closed — Silver Jubilee', () => {
    expect(cal.isOpen(utc('1977-06-07'))).toBe(false);
  });

  // Golden Jubilee 2002: Spring Bank Holiday MOVED — regular last-Mon-May (May 27 2002) is OPEN.
  it('2002-05-27 (Mon, would-be Spring Bank) is OPEN — moved for Golden Jubilee', () => {
    expect(cal.isOpen(utc('2002-05-27'))).toBe(true);
  });
  it('2002-06-03 closed — Golden Jubilee', () => {
    expect(cal.isOpen(utc('2002-06-03'))).toBe(false);
  });
  it('2002-06-04 closed — Golden Jubilee additional', () => {
    expect(cal.isOpen(utc('2002-06-04'))).toBe(false);
  });

  // Diamond Jubilee 2012: Spring Bank Holiday MOVED — regular last-Mon-May (May 28 2012) is OPEN.
  it('2012-05-28 (Mon, would-be Spring Bank) is OPEN — moved for Diamond Jubilee', () => {
    expect(cal.isOpen(utc('2012-05-28'))).toBe(true);
  });
  it('2012-06-04 closed — Diamond Jubilee', () => {
    expect(cal.isOpen(utc('2012-06-04'))).toBe(false);
  });
  it('2012-06-05 closed — Diamond Jubilee', () => {
    expect(cal.isOpen(utc('2012-06-05'))).toBe(false);
  });

  // Platinum Jubilee 2022: Spring Bank Holiday MOVED — regular last-Mon-May (May 30 2022) is OPEN.
  it('2022-05-30 (Mon, would-be Spring Bank) is OPEN — moved for Platinum Jubilee', () => {
    expect(cal.isOpen(utc('2022-05-30'))).toBe(true);
  });
  it('2022-06-02 closed — Platinum Jubilee', () => {
    expect(cal.isOpen(utc('2022-06-02'))).toBe(false);
  });
  it('2022-06-03 closed — Platinum Jubilee', () => {
    expect(cal.isOpen(utc('2022-06-03'))).toBe(false);
  });
});

describe('LSE — Royal weddings', () => {
  it('1973-11-14 closed — Princess Anne wedding', () => {
    expect(cal.isOpen(utc('1973-11-14'))).toBe(false);
  });
  it('1981-07-29 closed — Prince Charles + Diana wedding', () => {
    expect(cal.isOpen(utc('1981-07-29'))).toBe(false);
  });
  it('2011-04-29 closed — Prince William + Catherine wedding', () => {
    expect(cal.isOpen(utc('2011-04-29'))).toBe(false);
  });
});

describe('LSE — Coronation of King Charles III', () => {
  it('2023-05-08 (Mon) closed — Coronation', () => {
    expect(cal.isOpen(utc('2023-05-08'))).toBe(false);
  });
  // Sanity: the regular Spring Bank Holiday in 2023 is May 29, still observed.
  it('2023-05-29 closed — Spring Bank Holiday (regular)', () => {
    expect(cal.isOpen(utc('2023-05-29'))).toBe(false);
  });
});

describe('LSE — State funeral', () => {
  it('2022-09-19 closed — Queen Elizabeth II state funeral', () => {
    expect(cal.isOpen(utc('2022-09-19'))).toBe(false);
  });
});

describe('LSE — Millennium Eve', () => {
  it('1999-12-31 closed — Eve of 3rd Millennium', () => {
    expect(cal.isOpen(utc('1999-12-31'))).toBe(false);
  });
});

describe('LSE — New Year weekend observances', () => {
  // 2022-01-01 was a Saturday → New Year's Day observed Mon 2022-01-03.
  it('2022-01-03 (Mon) closed — observed New Years Day', () => {
    expect(cal.isOpen(utc('2022-01-03'))).toBe(false);
  });
  // 2023-01-01 was a Sunday → observed Mon 2023-01-02.
  it('2023-01-02 (Mon) closed — observed New Years Day', () => {
    expect(cal.isOpen(utc('2023-01-02'))).toBe(false);
  });
});

describe('LSE — early closes (12:30 London)', () => {
  it('2024-12-24 (Tue) closes 12:30 London', () => {
    const session = sessionFor(utc('2024-12-24'));
    expect(session).toBeDefined();
    if (!session) return;
    expect(cal.isEarlyClose(utc('2024-12-24'))).toBe(true);
    expect(localTime(session.close, 'Europe/London')).toEqual({ h: 12, m: 30 });
  });
  it('2024-12-31 (Tue) closes 12:30 London', () => {
    const session = sessionFor(utc('2024-12-31'));
    expect(session).toBeDefined();
    if (!session) return;
    expect(cal.isEarlyClose(utc('2024-12-31'))).toBe(true);
    expect(localTime(session.close, 'Europe/London')).toEqual({ h: 12, m: 30 });
  });
  // previous_friday observance: 2022-12-24 was Saturday → early close moves to Fri Dec 23.
  it('2022-12-23 (Fri) closes 12:30 London — previous_friday observance for Dec 24 Sat', () => {
    const session = sessionFor(utc('2022-12-23'));
    expect(session).toBeDefined();
    if (!session) return;
    expect(cal.isEarlyClose(utc('2022-12-23'))).toBe(true);
    expect(localTime(session.close, 'Europe/London')).toEqual({ h: 12, m: 30 });
  });
});

describe('LSE — session times across BST/GMT', () => {
  // Summer (BST, UTC+1): 16:30 London = 15:30 UTC
  it('2024-06-03 (Mon, BST) close = 16:30 London = 15:30 UTC', () => {
    const session = sessionFor(utc('2024-06-03'));
    expect(session).toBeDefined();
    if (!session) return;
    expect(localTime(session.close, 'Europe/London')).toEqual({ h: 16, m: 30 });
    expect(localTime(session.close, 'UTC')).toEqual({ h: 15, m: 30 });
    expect(localTime(session.open, 'Europe/London')).toEqual({ h: 8, m: 0 });
    expect(localTime(session.open, 'UTC')).toEqual({ h: 7, m: 0 });
  });
  // Winter (GMT, UTC+0): 16:30 London = 16:30 UTC
  it('2024-01-08 (Mon, GMT) close = 16:30 London = 16:30 UTC', () => {
    const session = sessionFor(utc('2024-01-08'));
    expect(session).toBeDefined();
    if (!session) return;
    expect(localTime(session.close, 'Europe/London')).toEqual({ h: 16, m: 30 });
    expect(localTime(session.close, 'UTC')).toEqual({ h: 16, m: 30 });
    expect(localTime(session.open, 'Europe/London')).toEqual({ h: 8, m: 0 });
    expect(localTime(session.open, 'UTC')).toEqual({ h: 8, m: 0 });
  });
});

describe('LSE — schedule sanity (May 2024)', () => {
  it('May 2024 trading days exclude both bank holidays', () => {
    const sessions = cal.schedule({ from: utc('2024-05-01'), to: utc('2024-06-01') });
    const dates = sessions.map((s) => s.date.toISOString().slice(0, 10));
    expect(dates).not.toContain('2024-05-06');
    expect(dates).not.toContain('2024-05-27');
    // Spot-check a couple of regular trading days are present.
    expect(dates).toContain('2024-05-07');
    expect(dates).toContain('2024-05-28');
  });
});
