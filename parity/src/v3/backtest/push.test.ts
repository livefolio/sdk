import { describe, it, expect } from 'vitest';
import { SimulationHandle } from './types';
import type { FinalState, Trade } from './types';
import { AllocationHandle } from '../handles/allocation';
import { TickerHandle } from '../handles/ticker';
import { PortfolioHandle } from '../handles/portfolio';

function stubTicker(symbol: string, leverage: number = 1): TickerHandle {
  return { symbol, leverage } as TickerHandle;
}

function stubAllocation(holdings: [TickerHandle, number][]): AllocationHandle {
  const handle = Object.create(AllocationHandle.prototype) as AllocationHandle;
  Object.defineProperty(handle, 'holdings', { value: holdings, writable: false });
  return handle;
}

function makeFinalState(
  portfolioHoldings: [TickerHandle, number][],
  allocation: AllocationHandle,
  closePrices: Record<string, number>,
  leveragedPrices: Record<string, number>,
): FinalState {
  return {
    portfolio: new PortfolioHandle(portfolioHoldings),
    allocation,
    closePrices,
    leveragedPrices,
  };
}

describe('SimulationHandle.push()', () => {
  // Task 4 — basic valuation

  it('returns updated value when price increases', () => {
    const spy = stubTicker('SPY');
    const alloc = stubAllocation([[spy, 1.0]]);
    const finalState = makeFinalState(
      [
        [spy, 200],
        [stubTicker('CASHX'), 0],
      ],
      alloc,
      { SPY: 510 },
      { 'SPY:1': 510 },
    );

    const sim = new SimulationHandle(
      [{ date: '2025-01-08', value: 102_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      finalState,
    );

    const snap = sim.push([spy, 520]);
    expect(snap.value).toBeCloseTo(104_000, 2);
  });

  it('returns same value when price unchanged', () => {
    const spy = stubTicker('SPY');
    const alloc = stubAllocation([[spy, 1.0]]);
    const finalState = makeFinalState(
      [
        [spy, 200],
        [stubTicker('CASHX'), 0],
      ],
      alloc,
      { SPY: 510 },
      { 'SPY:1': 510 },
    );

    const sim = new SimulationHandle(
      [{ date: '2025-01-08', value: 102_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      finalState,
    );

    const snap = sim.push([spy, 510]);
    expect(snap.value).toBeCloseTo(102_000, 2);
  });

  it('retains last pushed price for missing symbols', () => {
    const spy = stubTicker('SPY');
    const tlt = stubTicker('TLT');
    const alloc = stubAllocation([
      [spy, 0.6],
      [tlt, 0.4],
    ]);
    const finalState = makeFinalState(
      [
        [spy, 120],
        [tlt, 400],
        [stubTicker('CASHX'), 0],
      ],
      alloc,
      { SPY: 500, TLT: 100 },
      { 'SPY:1': 500, 'TLT:1': 100 },
    );

    const sim = new SimulationHandle(
      [{ date: '2025-01-08', value: 100_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      finalState,
    );

    // Push only SPY at 510. TLT retains 100.
    const snap1 = sim.push([spy, 510]);
    // 120*510 + 400*100 = 61200 + 40000 = 101200
    expect(snap1.value).toBeCloseTo(101_200, 2);

    // Push SPY at 520 (return computed from CLOSE=500, not previous push=510)
    const snap2 = sim.push([spy, 520]);
    // 120*520 + 400*100 = 62400 + 40000 = 102400
    expect(snap2.value).toBeCloseTo(102_400, 2);
  });

  // Task 5 — leverage

  it('applies leverage to raw price changes', () => {
    const spy2 = stubTicker('SPY', 2);
    const alloc = stubAllocation([[spy2, 1.0]]);
    // Close: raw SPY=500, leveraged price=1000
    const finalState = makeFinalState(
      [
        [spy2, 100],
        [stubTicker('CASHX'), 0],
      ],
      alloc,
      { SPY: 500 },
      { 'SPY:2': 1000 },
    );

    const sim = new SimulationHandle(
      [{ date: '2025-01-08', value: 100_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      finalState,
    );

    // Push raw SPY at 505 (+1%). Leveraged return = 2*1% = 2%.
    // New leveraged price = 1000 * 1.02 = 1020
    // Value = 100 * 1020 = 102000
    const snap = sim.push([spy2, 505]);
    expect(snap.value).toBeCloseTo(102_000, 2);
  });

  it('computes leverage from historical close, not previous push', () => {
    const spy2 = stubTicker('SPY', 2);
    const alloc = stubAllocation([[spy2, 1.0]]);
    const finalState = makeFinalState(
      [
        [spy2, 100],
        [stubTicker('CASHX'), 0],
      ],
      alloc,
      { SPY: 500 },
      { 'SPY:2': 1000 },
    );

    const sim = new SimulationHandle(
      [{ date: '2025-01-08', value: 100_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      finalState,
    );

    // First push: SPY at 505 (+1% from close). Leveraged: 1000 * 1.02 = 1020
    const snap1 = sim.push([spy2, 505]);
    expect(snap1.value).toBeCloseTo(102_000, 2);

    // Second push: SPY at 510 (+2% from CLOSE=500). Leveraged: 1000 * 1.04 = 1040 (NOT from 1020)
    const snap2 = sim.push([spy2, 510]);
    expect(snap2.value).toBeCloseTo(104_000, 2);
  });

  // Task 6 — edge cases

  it('ignores unknown symbols', () => {
    const spy = stubTicker('SPY');
    const aapl = stubTicker('AAPL');
    const alloc = stubAllocation([[spy, 1.0]]);
    const finalState = makeFinalState(
      [
        [spy, 200],
        [stubTicker('CASHX'), 0],
      ],
      alloc,
      { SPY: 500 },
      { 'SPY:1': 500 },
    );

    const sim = new SimulationHandle(
      [{ date: '2025-01-08', value: 100_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      finalState,
    );

    // Push AAPL (not in portfolio). Value unchanged at 100,000.
    const snap = sim.push([aapl, 150]);
    expect(snap.value).toBeCloseTo(100_000, 2);
  });

  it('ignores CASHX in push args', () => {
    const spy = stubTicker('SPY');
    const cashx = stubTicker('CASHX');
    const alloc = stubAllocation([[spy, 1.0]]);
    const finalState = makeFinalState(
      [
        [spy, 200],
        [stubTicker('CASHX'), 0],
      ],
      alloc,
      { SPY: 500 },
      { 'SPY:1': 500 },
    );

    const sim = new SimulationHandle(
      [{ date: '2025-01-08', value: 100_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      finalState,
    );

    // Push CASHX at 999. Value unchanged.
    const snap = sim.push([cashx, 999]);
    expect(snap.value).toBeCloseTo(100_000, 2);
  });

  it('returns empty snapshot when no finalState', () => {
    const sim = new SimulationHandle([], [], new PortfolioHandle([[stubTicker('CASHX'), 0]]));

    const snap = sim.push([stubTicker('SPY'), 500]);
    expect(snap).toEqual({ value: 0, holdings: [], weights: [], pendingTrades: [] });
  });

  it('returns pendingTrades showing what rebalance would do', () => {
    const spy = stubTicker('SPY');
    const tlt = stubTicker('TLT');
    const alloc = stubAllocation([
      [spy, 0.6],
      [tlt, 0.4],
    ]);

    // Portfolio drifted from 60/40: SPY overweight at ~72%
    // SPY: 120 shares @ 600 = 72000, TLT: 280 shares @ 100 = 28000, total = 100000
    const finalState = makeFinalState(
      [
        [spy, 120],
        [tlt, 280],
        [stubTicker('CASHX'), 0],
      ],
      alloc,
      { SPY: 600, TLT: 100 },
      { 'SPY:1': 600, 'TLT:1': 100 },
    );

    const sim = new SimulationHandle(
      [{ date: '2025-01-08', value: 100_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      finalState,
    );

    // Push at current close prices — no price change but portfolio is drifted
    const snap = sim.push([spy, 600], [tlt, 100]);

    // Total value = 120*600 + 280*100 = 100000
    // Target SPY = 60000 (100 shares), current SPY = 72000 (120 shares) → sell 20 shares
    // Target TLT = 40000 (400 shares), current TLT = 28000 (280 shares) → buy 120 shares
    expect(snap.pendingTrades.length).toBeGreaterThanOrEqual(2);

    const spySell = snap.pendingTrades.find((t: Trade) => t.symbol === 'SPY');
    expect(spySell).toBeDefined();
    expect(spySell!.action).toBe('sell');

    const tltBuy = snap.pendingTrades.find((t: Trade) => t.symbol === 'TLT');
    expect(tltBuy).toBeDefined();
    expect(tltBuy!.action).toBe('buy');
  });
});
