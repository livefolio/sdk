import { describe, it, expect, vi } from 'vitest';
import type { MarketProvider } from './market';
import type { DailyBar } from '../handles/indicator';
import { createQuoteOverlay } from './quote-overlay';

function fakeBase(bars: DailyBar[]): MarketProvider {
  return { fetchBars: vi.fn().mockResolvedValue(bars) };
}

describe('createQuoteOverlay', () => {
  it('passes through unchanged when no overrides match the symbol', async () => {
    const base = fakeBase([
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 101 },
    ]);
    const overlay = createQuoteOverlay(base, { '2026-04-17': { OTHER: 50 } });
    const bars = await overlay.fetchBars('SPY');
    expect(bars).toEqual([
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 101 },
    ]);
  });

  it('appends a synthetic bar for the target date when not in base bars', async () => {
    const base = fakeBase([
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 101 },
    ]);
    const overlay = createQuoteOverlay(base, { '2026-04-17': { SPY: 103 } });
    const bars = await overlay.fetchBars('SPY');
    expect(bars).toEqual([
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 101 },
      { date: '2026-04-17', value: 103 },
    ]);
  });

  it('replaces a bar when the target date already exists in base bars', async () => {
    const base = fakeBase([
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 101 },
      { date: '2026-04-17', value: 99 },
    ]);
    const overlay = createQuoteOverlay(base, { '2026-04-17': { SPY: 103 } });
    const bars = await overlay.fetchBars('SPY');
    expect(bars).toEqual([
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 101 },
      { date: '2026-04-17', value: 103 },
    ]);
  });

  it('falls back to the last base bar value when override has the date but not this symbol', async () => {
    const base = fakeBase([
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 101 },
    ]);
    const overlay = createQuoteOverlay(base, { '2026-04-17': { QQQ: 400 } }, { fallbackMissingQuotes: true });
    const bars = await overlay.fetchBars('SPY');
    expect(bars).toEqual([
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 101 },
      { date: '2026-04-17', value: 101 },
    ]);
  });

  it('does not fall back by default when override has the date but not this symbol', async () => {
    const base = fakeBase([
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 101 },
    ]);
    const overlay = createQuoteOverlay(base, { '2026-04-17': { QQQ: 400 } });
    const bars = await overlay.fetchBars('SPY');
    expect(bars).toEqual([
      { date: '2026-04-15', value: 100 },
      { date: '2026-04-16', value: 101 },
    ]);
  });

  it('forwards from argument to base', async () => {
    const base = fakeBase([]);
    const overlay = createQuoteOverlay(base, {});
    await overlay.fetchBars('SPY', '2026-04-01');
    expect(base.fetchBars).toHaveBeenCalledWith('SPY', '2026-04-01');
  });
});
