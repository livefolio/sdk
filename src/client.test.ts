import { describe, it, expect } from 'vitest';
import { createClient } from './client.js';
import type { StorageProvider } from './providers/storage.js';
import type { MarketProvider } from './providers/market.js';

const storage = {} as StorageProvider;
const market = {} as MarketProvider;

describe('createClient', () => {
  it('returns an object with expected factory methods', () => {
    const client = createClient({ storage, market });
    expect(client).toBeDefined();
    expect(typeof client.ticker).toBe('function');
    expect(typeof client.sma).toBe('function');
    expect(typeof client.ema).toBe('function');
    expect(typeof client.price).toBe('function');
    expect(typeof client.returns).toBe('function');
    expect(typeof client.volatility).toBe('function');
    expect(typeof client.drawdown).toBe('function');
    expect(typeof client.rsi).toBe('function');
    expect(typeof client.vix).toBe('function');
    expect(typeof client.vix3m).toBe('function');
    expect(typeof client.treasury).toBe('function');
    expect(typeof client.calendar).toBe('function');
    expect(typeof client.threshold).toBe('function');
    expect(typeof client.gt).toBe('function');
    expect(typeof client.lt).toBe('function');
    expect(typeof client.eq).toBe('function');
    expect(typeof client.allocation).toBe('function');
    expect(typeof client.portfolio).toBe('function');
    expect(typeof client.strategy).toBe('function');
  });
});
