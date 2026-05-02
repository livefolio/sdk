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
