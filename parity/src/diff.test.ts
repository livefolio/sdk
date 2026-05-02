import { describe, it, expect } from 'vitest';
import { compareAllocationHistories } from './diff';
import type { AllocationHistory } from './extract-history';

const A: AllocationHistory = [
  { date: '2024-01-02', weights: { 'us:SPY': 1.0 } },
  { date: '2024-01-03', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
];

describe('compareAllocationHistories', () => {
  it('returns empty diffs for identical histories', () => {
    const r = compareAllocationHistories(A, A);
    expect(r.diffs).toEqual([]);
    expect(r.onlyInA).toEqual([]);
    expect(r.onlyInB).toEqual([]);
    expect(r.matched).toBe(3);
  });

  it('flags weight deltas outside tolerance', () => {
    const B: AllocationHistory = [
      { date: '2024-01-02', weights: { 'us:SPY': 1.0 } },
      { date: '2024-01-03', weights: { 'us:SPY': 0.5, 'us:QQQ': 0.5 } },
    ];
    const r = compareAllocationHistories(A, B);
    expect(r.diffs.length).toBe(2);
    const qqq = r.diffs.find((d) => d.assetId === 'us:QQQ')!;
    expect(qqq).toMatchObject({ date: '2024-01-03', a: 0.4, b: 0.5 });
  });

  it('treats deltas within tolerance as matched', () => {
    const B: AllocationHistory = [
      { date: '2024-01-02', weights: { 'us:SPY': 1.0 + 1e-12 } },
      { date: '2024-01-03', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
    ];
    const r = compareAllocationHistories(A, B);
    expect(r.diffs).toEqual([]);
  });

  it('catches dates only in one side', () => {
    const B: AllocationHistory = [{ date: '2024-01-02', weights: { 'us:SPY': 1.0 } }];
    const r = compareAllocationHistories(A, B);
    expect(r.onlyInA).toEqual(['2024-01-03']);
    expect(r.onlyInB).toEqual([]);
  });

  it('handles assets present on only one side', () => {
    const B: AllocationHistory = [
      { date: '2024-01-02', weights: { 'us:SPY': 1.0 } },
      { date: '2024-01-03', weights: { 'us:SPY': 1.0 } },
    ];
    const r = compareAllocationHistories(A, B);
    expect(r.diffs.length).toBe(2);
    const qqq = r.diffs.find((d) => d.assetId === 'us:QQQ')!;
    expect(qqq).toMatchObject({ a: 0.4, b: 0, delta: -0.4 });
  });

  it('honors ignoreDates and ignoreAssets', () => {
    const B: AllocationHistory = [
      { date: '2024-01-02', weights: { 'us:SPY': 1.0 } },
      { date: '2024-01-03', weights: { 'us:SPY': 0.5, 'us:QQQ': 0.5 } },
    ];
    const r1 = compareAllocationHistories(A, B, { ignoreDates: new Set(['2024-01-03']) });
    expect(r1.diffs).toEqual([]);
    const r2 = compareAllocationHistories(A, B, { ignoreAssets: new Set(['us:SPY', 'us:QQQ']) });
    expect(r2.diffs).toEqual([]);
  });
});
