import { describe, it, expect, vi } from 'vitest';
import { allocationsEqual } from './allocation-equality';
import { AllocationHandle } from './allocation';
import { TickerHandle } from './ticker';
import type { StorageProvider } from '../providers/storage';

function mockStorage(): StorageProvider {
  return {
    tickers: { findOrCreate: vi.fn().mockResolvedValue({ id: 1 }) },
    indicators: {} as StorageProvider['indicators'],
    signals: {} as StorageProvider['signals'],
    allocations: { findOrCreate: vi.fn().mockResolvedValue({ id: 10 }) },
    strategies: {} as StorageProvider['strategies'],
    tradingDays: {} as StorageProvider['tradingDays'],
  };
}

function makeAllocation(storage: StorageProvider, holdings: [string, number, number][]) {
  const pairs: [TickerHandle, number][] = holdings.map(([sym, lev, w]) => [new TickerHandle(storage, sym, lev), w]);
  return new AllocationHandle(storage, pairs);
}

describe('allocationsEqual', () => {
  it('(null, null) → true', () => {
    expect(allocationsEqual(null, null)).toBe(true);
  });

  it('(null, a) → false', () => {
    const storage = mockStorage();
    const a = makeAllocation(storage, [['SPY', 1, 1.0]]);
    expect(allocationsEqual(null, a)).toBe(false);
  });

  it('(a, null) → false', () => {
    const storage = mockStorage();
    const a = makeAllocation(storage, [['SPY', 1, 1.0]]);
    expect(allocationsEqual(a, null)).toBe(false);
  });

  it('same holdings → true', () => {
    const storage = mockStorage();
    const a = makeAllocation(storage, [['SPY', 1, 1.0]]);
    const b = makeAllocation(storage, [['SPY', 1, 1.0]]);
    expect(allocationsEqual(a, b)).toBe(true);
  });

  it('weight drift within 1e-9 → true', () => {
    const storage = mockStorage();
    const a = makeAllocation(storage, [
      ['SPY', 1, 0.6],
      ['GLD', 1, 0.4],
    ]);
    // Construct b with weights that sum to 1 but differ by tiny epsilon
    const epsilon = 5e-10;
    const spyB = new TickerHandle(storage, 'SPY', 1);
    const gldB = new TickerHandle(storage, 'GLD', 1);
    const b = new AllocationHandle(storage, [
      [spyB, 0.6 + epsilon],
      [gldB, 0.4 - epsilon],
    ]);
    expect(allocationsEqual(a, b)).toBe(true);
  });

  it('weight drift > 1e-9 → false', () => {
    const storage = mockStorage();
    const a = makeAllocation(storage, [
      ['SPY', 1, 0.6],
      ['GLD', 1, 0.4],
    ]);
    const spyB = new TickerHandle(storage, 'SPY', 1);
    const gldB = new TickerHandle(storage, 'GLD', 1);
    const b = new AllocationHandle(storage, [
      [spyB, 0.601],
      [gldB, 0.399],
    ]);
    expect(allocationsEqual(a, b)).toBe(false);
  });

  it('different length → false', () => {
    const storage = mockStorage();
    const a = makeAllocation(storage, [['SPY', 1, 1.0]]);
    const b = makeAllocation(storage, [
      ['SPY', 1, 0.6],
      ['GLD', 1, 0.4],
    ]);
    expect(allocationsEqual(a, b)).toBe(false);
  });

  it('same length, different symbols → false', () => {
    const storage = mockStorage();
    const a = makeAllocation(storage, [['SPY', 1, 1.0]]);
    const b = makeAllocation(storage, [['GLD', 1, 1.0]]);
    expect(allocationsEqual(a, b)).toBe(false);
  });

  it('same symbols at different leverages → false', () => {
    const storage = mockStorage();
    const a = makeAllocation(storage, [['SPY', 1, 1.0]]);
    const b = makeAllocation(storage, [['SPY', 2, 1.0]]);
    expect(allocationsEqual(a, b)).toBe(false);
  });
});
