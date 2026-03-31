import { describe, it, expect } from 'vitest';
import { TickerHandle } from './ticker.js';
import { IndicatorHandle } from './indicator.js';
import { SignalHandle } from './signal.js';
import { AllocationHandle } from './allocation.js';
import type { TypedSupabaseClient } from '../types.js';

const sb = {} as TypedSupabaseClient;

describe('TickerHandle.fromRow', () => {
  it('creates a pre-resolved handle', () => {
    const row = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const handle = TickerHandle.fromRow(sb, row);
    expect(handle.symbol).toBe('SPY');
    expect(handle.leverage).toBe(1);
    expect(handle.id).toBe(1);
  });

  it('resolve() returns cached row without DB call', async () => {
    const row = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const handle = TickerHandle.fromRow(sb, row);
    const result = await handle.resolve();
    expect(result).toEqual(row);
  });
});

describe('IndicatorHandle.fromRow', () => {
  it('creates a pre-resolved handle with ticker', () => {
    const tickerRow = { id: 1, symbol: 'SPY', leverage: 1, created_at: '' };
    const ticker = TickerHandle.fromRow(sb, tickerRow);
    const row = {
      id: 10,
      type: 'SMA' as const,
      ticker_id: 1,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
      created_at: '',
    };
    const handle = IndicatorHandle.fromRow(sb, row, ticker);
    expect(handle.type).toBe('SMA');
    expect(handle.ticker).toBe(ticker);
    expect(handle.lookback).toBe(200);
    expect(handle.id).toBe(10);
  });

  it('creates a pre-resolved handle without ticker', () => {
    const row = {
      id: 20,
      type: 'VIX' as const,
      ticker_id: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
      created_at: '',
    };
    const handle = IndicatorHandle.fromRow(sb, row, null);
    expect(handle.type).toBe('VIX');
    expect(handle.ticker).toBeNull();
    expect(handle.id).toBe(20);
  });
});

describe('SignalHandle.fromRow', () => {
  it('creates a pre-resolved handle', () => {
    const ind1 = new IndicatorHandle(sb, {
      type: 'Price',
      ticker: null,
      lookback: 0,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const ind2 = new IndicatorHandle(sb, {
      type: 'SMA',
      ticker: null,
      lookback: 200,
      delay: 0,
      unit: null,
      threshold: null,
    });
    const row = {
      id: 100,
      indicator_id_1: 10,
      indicator_id_2: 11,
      comparison: '>' as const,
      tolerance: 5,
      created_at: '',
    };
    const handle = SignalHandle.fromRow(sb, row, ind1, ind2);
    expect(handle.comparison).toBe('>');
    expect(handle.tolerance).toBe(5);
    expect(handle.indicator1).toBe(ind1);
    expect(handle.indicator2).toBe(ind2);
    expect(handle.id).toBe(100);
  });
});

describe('AllocationHandle.fromRow', () => {
  it('creates a pre-resolved handle from JSONB holdings', () => {
    const row = { id: 50, holdings: { SPY: 0.6, GLD: 0.4 }, created_at: '' };
    const handle = AllocationHandle.fromRow(sb, row);
    expect(handle.id).toBe(50);
    expect(handle.holdings).toHaveLength(2);
  });

  it('parses leverage from key format', () => {
    const row = { id: 51, holdings: { 'SPXL?L=3': 1.0 }, created_at: '' };
    const handle = AllocationHandle.fromRow(sb, row);
    expect(handle.holdings[0][0].symbol).toBe('SPXL');
    expect(handle.holdings[0][0].leverage).toBe(3);
  });

  it('resolve() returns cached row', async () => {
    const row = { id: 50, holdings: { SPY: 1.0 }, created_at: '' };
    const handle = AllocationHandle.fromRow(sb, row);
    const result = await handle.resolve();
    expect(result).toEqual(row);
  });
});
