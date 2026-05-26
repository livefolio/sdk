import { describe, it, expect } from 'vitest';
import { dueCashFlow } from './apply-cash-events';

const d = (iso: string) => new Date(iso);

describe('dueCashFlow', () => {
  it('returns 0 when no events are due', () => {
    expect(dueCashFlow([{ t: d('2024-02-01'), delta: 100 }], d('2024-01-15'))).toBe(0);
  });
  it('sums events with t <= sessionT', () => {
    expect(
      dueCashFlow(
        [
          { t: d('2024-01-10'), delta: 100 },
          { t: d('2024-01-15'), delta: 200 },
        ],
        d('2024-01-15'),
      ),
    ).toBe(300);
  });
  it('excludes future events', () => {
    expect(
      dueCashFlow(
        [
          { t: d('2024-01-10'), delta: 100 },
          { t: d('2024-02-01'), delta: 200 },
        ],
        d('2024-01-15'),
      ),
    ).toBe(100);
  });
  it('returns 0 for empty array', () => {
    expect(dueCashFlow([], d('2024-01-15'))).toBe(0);
  });
  it('includes event with t exactly equal to sessionT', () => {
    expect(dueCashFlow([{ t: d('2024-01-15'), delta: 500 }], d('2024-01-15'))).toBe(500);
  });
  it('sums multiple events all before sessionT', () => {
    expect(
      dueCashFlow(
        [
          { t: d('2024-01-01'), delta: 100 },
          { t: d('2024-01-05'), delta: -50 },
          { t: d('2024-01-10'), delta: 200 },
        ],
        d('2024-01-15'),
      ),
    ).toBe(250);
  });
});
