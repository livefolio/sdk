import { describe, it, expect } from 'vitest';
import { computeDrawdownTable, currentDrawdown } from './drawdown';
import type { DailyBar } from '../handles/indicator';

const bars = (entries: Array<[string, number]>): DailyBar[] => entries.map(([date, value]) => ({ date, value }));

describe('computeDrawdownTable', () => {
  it('captures a recovered DD with correct peak/trough/recovery', () => {
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-03', 90],
      ['2024-01-05', 80],
      ['2024-01-08', 95],
      ['2024-01-10', 100],
      ['2024-01-15', 110],
    ]);
    const dd = computeDrawdownTable(s, 5);
    expect(dd).toHaveLength(1);
    expect(dd[0]!.peakDate).toBe('2024-01-01');
    expect(dd[0]!.troughDate).toBe('2024-01-05');
    expect(dd[0]!.recoveryDate).toBe('2024-01-10');
    expect(dd[0]!.depth).toBeCloseTo(-0.2, 10);
    expect(dd[0]!.durationDays).toBe(9);
    expect(dd[0]!.underwaterDays).toBe(4);
  });

  it('records ongoing DD with recoveryDate=null', () => {
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-05', 90],
      ['2024-01-10', 85],
    ]);
    const dd = computeDrawdownTable(s, 5);
    expect(dd).toHaveLength(1);
    expect(dd[0]!.recoveryDate).toBeNull();
    expect(dd[0]!.peakDate).toBe('2024-01-01');
    expect(dd[0]!.troughDate).toBe('2024-01-10');
    expect(dd[0]!.durationDays).toBe(9);
  });

  it('returns top N sorted by depth', () => {
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-05', 80],
      ['2024-01-10', 100],
      ['2024-01-12', 90],
      ['2024-01-15', 100],
    ]);
    const dd = computeDrawdownTable(s, 5);
    expect(dd).toHaveLength(2);
    expect(dd[0]!.depth).toBeCloseTo(-0.2, 10);
    expect(dd[1]!.depth).toBeCloseTo(-0.1, 10);
  });

  it('topN truncates', () => {
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-02', 95],
      ['2024-01-03', 100],
      ['2024-01-04', 90],
      ['2024-01-05', 100],
      ['2024-01-06', 80],
      ['2024-01-07', 100],
    ]);
    expect(computeDrawdownTable(s, 1)).toHaveLength(1);
    expect(computeDrawdownTable(s, 2)).toHaveLength(2);
  });

  it('filters out near-zero drawdowns', () => {
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-02', 99.999],
      ['2024-01-03', 100],
    ]);
    expect(computeDrawdownTable(s, 5)).toHaveLength(0);
  });
});

describe('currentDrawdown', () => {
  it('returns 0 when at all-time high', () => {
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-02', 110],
    ]);
    expect(currentDrawdown(s)).toBeCloseTo(0, 10);
  });

  it('returns negative pct when underwater', () => {
    const s = bars([
      ['2024-01-01', 100],
      ['2024-01-02', 110],
      ['2024-01-03', 99],
    ]);
    expect(currentDrawdown(s)).toBeCloseTo(-0.1, 10);
  });
});
