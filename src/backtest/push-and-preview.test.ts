import { describe, it, expect, vi } from 'vitest';
import { SimulationHandle } from './types';
import type { FinalState, LiveEvaluator, StrategyLiveState } from './types';
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

function baseFinalState(): FinalState {
  const spy = stubTicker('SPY');
  const cash = stubTicker('CASHX');
  const portfolio = new PortfolioHandle([
    [spy, 200],
    [cash, 0],
  ]);
  return {
    portfolio,
    allocation: stubAllocation([[spy, 1.0]]),
    closePrices: { SPY: 500 },
    leveragedPrices: { 'SPY:1': 500 },
  };
}

function stubLiveState(overrides?: Partial<StrategyLiveState>): StrategyLiveState {
  return {
    allocation: null,
    activeRuleIndex: 0,
    rules: [{ signals: [] }],
    ...overrides,
  };
}

describe('SimulationHandle.pushAndPreview', () => {
  it('returns snapshot and empty strategy state when no liveEvaluator is attached', async () => {
    const sim = new SimulationHandle(
      [{ date: '2026-04-20', value: 100_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      baseFinalState(),
    );

    const result = await sim.pushAndPreview({ SPY: 510 });

    expect(result.snapshot.value).toBeCloseTo(102_000, 2);
    expect(result.allocation).toBeNull();
    expect(result.activeRuleIndex).toBe(-1);
    expect(result.rules).toEqual([]);
  });

  it('delegates strategy evaluation to the LiveEvaluator with accumulated overrides', async () => {
    const previewLiveState = vi.fn().mockResolvedValue(stubLiveState());
    const evaluator: LiveEvaluator = { previewLiveState };
    const sim = new SimulationHandle(
      [{ date: '2026-04-20', value: 100_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      baseFinalState(),
      evaluator,
    );

    await sim.pushAndPreview({ SPY: 510 }, { date: '2026-04-21' });
    await sim.pushAndPreview({ '^VIX': 14.2 }, { date: '2026-04-21' });

    expect(previewLiveState).toHaveBeenCalledTimes(2);
    expect(previewLiveState).toHaveBeenNthCalledWith(1, '2026-04-21', { SPY: 510 });
    // Second call accumulates — SPY from the first still present.
    expect(previewLiveState).toHaveBeenNthCalledWith(2, '2026-04-21', { SPY: 510, '^VIX': 14.2 });
  });

  it('only feeds portfolio-relevant tickers into push (not macro symbols)', async () => {
    const previewLiveState = vi.fn().mockResolvedValue(stubLiveState());
    const sim = new SimulationHandle(
      [{ date: '2026-04-20', value: 100_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      baseFinalState(),
      { previewLiveState },
    );

    // ^VIX is not in the portfolio; push should not touch it.
    const result = await sim.pushAndPreview({ '^VIX': 14.2 }, { date: '2026-04-21' });

    // Snapshot reflects no portfolio price change (no SPY quote passed).
    expect(result.snapshot.value).toBeCloseTo(100_000, 2);
    // Overrides still receive the macro quote.
    expect(previewLiveState).toHaveBeenCalledWith('2026-04-21', { '^VIX': 14.2 });
  });

  it('merges StrategyLiveState fields into the returned LivePreviewState', async () => {
    const spy = stubTicker('SPY');
    const alloc = stubAllocation([[spy, 1.0]]);
    const liveState: StrategyLiveState = {
      allocation: alloc,
      activeRuleIndex: 2,
      rules: [
        { signals: [] },
        { signals: [] },
        {
          signals: [
            {
              indicator1: { value: 510, date: '2026-04-21' },
              indicator2: { value: 470, date: '2026-04-21' },
              isTrue: true,
            },
          ],
        },
      ],
    };
    const sim = new SimulationHandle(
      [{ date: '2026-04-20', value: 100_000 }],
      [],
      new PortfolioHandle([[stubTicker('CASHX'), 100_000]]),
      baseFinalState(),
      { previewLiveState: vi.fn().mockResolvedValue(liveState) },
    );

    const result = await sim.pushAndPreview({ SPY: 510 }, { date: '2026-04-21' });

    expect(result.allocation).toBe(alloc);
    expect(result.activeRuleIndex).toBe(2);
    expect(result.rules).toBe(liveState.rules);
    expect(result.snapshot.value).toBeCloseTo(102_000, 2);
  });
});
