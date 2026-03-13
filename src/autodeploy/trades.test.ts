import { describe, it, expect, vi } from 'vitest';
import {
  mapTickerToBrokerable,
  buildTargetWeights,
  buildQuantityPrecisionBySymbol,
  extractBrokerageSlug,
  calculateRequiredTrades,
  FRED_BROKERABLE_MAP,
  BASE_TICKER_ALIASES,
  LEVERAGED_ETF_MAP,
} from './trades';
import type { BrokerOperations, HoldingsData } from './types';
import type { Allocation } from '../strategy/types';

// ---------------------------------------------------------------------------
// mapTickerToBrokerable
// ---------------------------------------------------------------------------

describe('mapTickerToBrokerable', () => {
  it('maps DTB3 to null (cash)', () => {
    expect(mapTickerToBrokerable({ symbol: 'DTB3', leverage: 1 })).toBeNull();
  });

  it('maps DFF to USFR', () => {
    expect(mapTickerToBrokerable({ symbol: 'DFF', leverage: 1 })).toBe('USFR');
  });

  it('FRED mapping takes priority over leverage', () => {
    expect(mapTickerToBrokerable({ symbol: 'DFF', leverage: 2 })).toBe('USFR');
    expect(mapTickerToBrokerable({ symbol: 'DTB3', leverage: 3 })).toBeNull();
  });

  it('maps leveraged ETFs', () => {
    expect(mapTickerToBrokerable({ symbol: 'SPY', leverage: 2 })).toBe('SSO');
    expect(mapTickerToBrokerable({ symbol: 'SPY', leverage: 3 })).toBe('UPRO');
    expect(mapTickerToBrokerable({ symbol: 'QQQ', leverage: 2 })).toBe('QLD');
    expect(mapTickerToBrokerable({ symbol: 'QQQ', leverage: 3 })).toBe('TQQQ');
    expect(mapTickerToBrokerable({ symbol: 'TLT', leverage: 2 })).toBe('UBT');
    expect(mapTickerToBrokerable({ symbol: 'TLT', leverage: 3 })).toBe('TMF');
    expect(mapTickerToBrokerable({ symbol: 'GLD', leverage: 2 })).toBe('UGL');
  });

  it('uses BASE_TICKER_ALIASES for leverage lookup', () => {
    expect(mapTickerToBrokerable({ symbol: 'VOO', leverage: 2 })).toBe('SSO');
    expect(mapTickerToBrokerable({ symbol: 'IVV', leverage: 3 })).toBe('UPRO');
  });

  it('passes through unmapped leveraged ticker with warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mapTickerToBrokerable({ symbol: 'ARKK', leverage: 2 })).toBe('ARKK');
    expect(warn).toHaveBeenCalledWith('No leveraged ETF mapping for ARKK at 2x — passing through as ARKK');
    warn.mockRestore();
  });

  it('passes through symbol at leverage 1', () => {
    expect(mapTickerToBrokerable({ symbol: 'QQQ', leverage: 1 })).toBe('QQQ');
    expect(mapTickerToBrokerable({ symbol: 'SPY', leverage: 1 })).toBe('SPY');
  });
});

// ---------------------------------------------------------------------------
// FRED_BROKERABLE_MAP, BASE_TICKER_ALIASES, LEVERAGED_ETF_MAP
// ---------------------------------------------------------------------------

describe('FRED_BROKERABLE_MAP', () => {
  it('contains expected mappings', () => {
    expect(FRED_BROKERABLE_MAP['DTB3']).toBeNull();
    expect(FRED_BROKERABLE_MAP['DFF']).toBe('USFR');
  });
});

describe('BASE_TICKER_ALIASES', () => {
  it('contains expected mappings', () => {
    expect(BASE_TICKER_ALIASES['VOO']).toBe('SPY');
    expect(BASE_TICKER_ALIASES['IVV']).toBe('SPY');
  });
});

describe('LEVERAGED_ETF_MAP', () => {
  it('contains expected leveraged mappings', () => {
    expect(LEVERAGED_ETF_MAP['SPY:2']).toBe('SSO');
    expect(LEVERAGED_ETF_MAP['SPY:3']).toBe('UPRO');
    expect(LEVERAGED_ETF_MAP['QQQ:2']).toBe('QLD');
    expect(LEVERAGED_ETF_MAP['QQQ:3']).toBe('TQQQ');
    expect(LEVERAGED_ETF_MAP['IWM:2']).toBe('UWM');
    expect(LEVERAGED_ETF_MAP['IWM:3']).toBe('TNA');
    expect(LEVERAGED_ETF_MAP['TLT:2']).toBe('UBT');
    expect(LEVERAGED_ETF_MAP['TLT:3']).toBe('TMF');
    expect(LEVERAGED_ETF_MAP['GLD:2']).toBe('UGL');
  });
});

// ---------------------------------------------------------------------------
// buildTargetWeights
// ---------------------------------------------------------------------------

describe('buildTargetWeights', () => {
  const dummyCondition = { kind: 'signal' as const, signal: {} as any };

  it('builds weights from a normal allocation', () => {
    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [
        { ticker: { symbol: 'SPY', leverage: 1 }, weight: 60 },
        { ticker: { symbol: 'QQQ', leverage: 1 }, weight: 40 },
      ],
    };

    const weights = buildTargetWeights(allocation);

    expect(weights.get('SPY')).toBe(60);
    expect(weights.get('QQQ')).toBe(40);
    expect(weights.size).toBe(2);
  });

  it('maps DTB3 (FRED cash) to CASH symbol', () => {
    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [
        { ticker: { symbol: 'SPY', leverage: 1 }, weight: 60 },
        { ticker: { symbol: 'DTB3', leverage: 1 }, weight: 40 },
      ],
    };

    const weights = buildTargetWeights(allocation);

    expect(weights.get('SPY')).toBe(60);
    expect(weights.get('CASH')).toBe(40);
    expect(weights.has('DTB3')).toBe(false);
  });

  it('aggregates duplicate symbols', () => {
    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [
        { ticker: { symbol: 'SPY', leverage: 1 }, weight: 30 },
        { ticker: { symbol: 'SPY', leverage: 1 }, weight: 20 },
      ],
    };

    const weights = buildTargetWeights(allocation);

    expect(weights.get('SPY')).toBe(50);
    expect(weights.size).toBe(1);
  });

  it('maps leveraged ETFs to brokerable symbols', () => {
    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [{ ticker: { symbol: 'QQQ', leverage: 3 }, weight: 100 }],
    };

    const weights = buildTargetWeights(allocation);

    expect(weights.get('TQQQ')).toBe(100);
    expect(weights.has('QQQ')).toBe(false);
  });

  it('throws on invalid weight', () => {
    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: -5 }],
    };

    expect(() => buildTargetWeights(allocation)).toThrow('Invalid target weight for SPY');
  });
});

// ---------------------------------------------------------------------------
// buildQuantityPrecisionBySymbol
// ---------------------------------------------------------------------------

describe('buildQuantityPrecisionBySymbol', () => {
  function createMockBroker(instruments: Array<{ symbol?: string; fractionable?: boolean }> = []): BrokerOperations {
    return {
      getHoldings: vi.fn(),
      getQuotes: vi.fn(),
      listInstruments: vi.fn().mockResolvedValue(instruments),
      placeOrder: vi.fn(),
      getOrderDetail: vi.fn(),
    };
  }

  it('returns default precision when no brokerage slug', async () => {
    const broker = createMockBroker();
    const result = await buildQuantityPrecisionBySymbol(broker, undefined, new Set(['SPY']));

    expect(result.get('SPY')).toBe(100);
    expect(broker.listInstruments).not.toHaveBeenCalled();
  });

  it('returns default precision when symbols set is empty', async () => {
    const broker = createMockBroker();
    const result = await buildQuantityPrecisionBySymbol(broker, 'alpaca', new Set());

    expect(result.size).toBe(0);
    expect(broker.listInstruments).not.toHaveBeenCalled();
  });

  it('sets whole-share precision for non-fractionable instruments', async () => {
    const broker = createMockBroker([
      { symbol: 'SPY', fractionable: true },
      { symbol: 'BRK.A', fractionable: false },
    ]);

    const result = await buildQuantityPrecisionBySymbol(broker, 'alpaca', new Set(['SPY', 'BRK.A']));

    expect(result.get('SPY')).toBe(100);
    expect(result.get('BRK.A')).toBe(1);
  });

  it('sets whole-share precision when fractionable flag is missing', async () => {
    const broker = createMockBroker([{ symbol: 'XYZ' }]);

    const result = await buildQuantityPrecisionBySymbol(broker, 'alpaca', new Set(['XYZ']));

    expect(result.get('XYZ')).toBe(1);
  });

  it('falls back to defaults on instrument fetch failure', async () => {
    const broker = createMockBroker();
    (broker.listInstruments as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));

    const result = await buildQuantityPrecisionBySymbol(broker, 'alpaca', new Set(['SPY']));

    expect(result.get('SPY')).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// extractBrokerageSlug
// ---------------------------------------------------------------------------

describe('extractBrokerageSlug', () => {
  it('extracts slug from holdings data', () => {
    const holdings: HoldingsData = {
      positions: [],
      balances: [],
      account: {
        brokerage_authorization: {
          brokerage: { slug: 'alpaca' },
        },
      },
    };

    expect(extractBrokerageSlug(holdings)).toBe('alpaca');
  });

  it('returns undefined when no brokerage authorization', () => {
    const holdings: HoldingsData = { positions: [], balances: [] };
    expect(extractBrokerageSlug(holdings)).toBeUndefined();
  });

  it('returns undefined when brokerage object is malformed', () => {
    const holdings: HoldingsData = {
      positions: [],
      balances: [],
      account: { brokerage_authorization: { brokerage: 'not-an-object' } },
    };
    expect(extractBrokerageSlug(holdings)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// calculateRequiredTrades
// ---------------------------------------------------------------------------

describe('calculateRequiredTrades', () => {
  const dummyCondition = { kind: 'signal' as const, signal: {} as any };

  function createMockBroker(overrides?: Partial<BrokerOperations>): BrokerOperations {
    return {
      getHoldings: vi.fn().mockResolvedValue({ positions: [], balances: [] }),
      getQuotes: vi.fn().mockResolvedValue([]),
      listInstruments: vi.fn().mockResolvedValue([]),
      placeOrder: vi.fn(),
      getOrderDetail: vi.fn(),
      ...overrides,
    };
  }

  it('returns empty array when total value is zero', async () => {
    const broker = createMockBroker();
    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
    };

    const result = await calculateRequiredTrades(broker, 'acct-1', allocation);

    expect(result).toEqual([]);
  });

  it('returns rebalance plan orders when drift exceeds threshold', async () => {
    const broker = createMockBroker({
      getHoldings: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: { symbol: { id: '1', symbol: 'SPY', exchange: { mic_code: 'XNAS' } } },
            currency: { code: 'USD' },
            units: 10,
            price: 100,
          },
        ],
        balances: [{ cash: 5000 }],
      }),
      getQuotes: vi.fn().mockResolvedValue([{ symbol: 'QQQ', lastTradePrice: 50 }]),
      listInstruments: vi.fn().mockResolvedValue([
        { symbol: 'SPY', fractionable: true },
        { symbol: 'QQQ', fractionable: true },
      ]),
    });

    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [
        { ticker: { symbol: 'SPY', leverage: 1 }, weight: 50 },
        { ticker: { symbol: 'QQQ', leverage: 1 }, weight: 50 },
      ],
    };

    const result = await calculateRequiredTrades(broker, 'acct-1', allocation);

    // Portfolio: SPY=$1000, cash=$5000, total=$6000
    // Target: SPY=50% ($3000), QQQ=50% ($3000)
    // Drift is large enough to trigger
    expect(result.length).toBeGreaterThan(0);
    const buyOrder = result.find((o) => o.action === 'BUY' && o.symbol === 'QQQ');
    expect(buyOrder).toBeDefined();
    expect(buyOrder!.quantity).toBeGreaterThan(0);
  });

  it('fetches quotes for symbols not in current positions', async () => {
    const getQuotes = vi.fn().mockResolvedValue([{ symbol: 'TLT', lastTradePrice: 100 }]);
    const broker = createMockBroker({
      getHoldings: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: { symbol: { id: '1', symbol: 'SPY', exchange: { mic_code: 'XNAS' } } },
            currency: { code: 'USD' },
            units: 100,
            price: 100,
          },
        ],
        balances: [{ cash: 0 }],
      }),
      getQuotes,
    });

    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [
        { ticker: { symbol: 'SPY', leverage: 1 }, weight: 50 },
        { ticker: { symbol: 'TLT', leverage: 1 }, weight: 50 },
      ],
    };

    await calculateRequiredTrades(broker, 'acct-1', allocation);

    expect(getQuotes).toHaveBeenCalledWith('acct-1', ['TLT']);
  });

  it('throws on missing market price for target symbol', async () => {
    const broker = createMockBroker({
      getHoldings: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: { symbol: { id: '1', symbol: 'SPY', exchange: { mic_code: 'XNAS' } } },
            currency: { code: 'USD' },
            units: 100,
            price: 100,
          },
        ],
        balances: [{ cash: 1000 }],
      }),
      getQuotes: vi.fn().mockResolvedValue([]),
    });

    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [
        { ticker: { symbol: 'SPY', leverage: 1 }, weight: 50 },
        { ticker: { symbol: 'TLT', leverage: 1 }, weight: 50 },
      ],
    };

    await expect(calculateRequiredTrades(broker, 'acct-1', allocation)).rejects.toThrow(
      'Missing or invalid market price for target symbol TLT',
    );
  });

  it('throws on duplicate holding rows', async () => {
    const broker = createMockBroker({
      getHoldings: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: { symbol: { id: '1', symbol: 'SPY', exchange: { mic_code: 'XNAS' } } },
            currency: { code: 'USD' },
            units: 10,
            price: 100,
          },
          {
            symbol: { symbol: { id: '1', symbol: 'SPY', exchange: { mic_code: 'XNAS' } } },
            currency: { code: 'USD' },
            units: 5,
            price: 100,
          },
        ],
        balances: [{ cash: 1000 }],
      }),
    });

    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
    };

    await expect(calculateRequiredTrades(broker, 'acct-1', allocation)).rejects.toThrow(
      'Duplicate holding row detected for symbol SPY',
    );
  });

  it('throws on invalid holdings data', async () => {
    const broker = createMockBroker({
      getHoldings: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: { symbol: { id: '1', symbol: 'SPY', exchange: { mic_code: 'XNAS' } } },
            currency: { code: 'USD' },
            units: -5,
            price: 100,
          },
        ],
        balances: [{ cash: 1000 }],
      }),
    });

    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
    };

    await expect(calculateRequiredTrades(broker, 'acct-1', allocation)).rejects.toThrow(
      'Invalid holdings data for symbol SPY',
    );
  });

  it('throws on invalid cash balance', async () => {
    const broker = createMockBroker({
      getHoldings: vi.fn().mockResolvedValue({
        positions: [],
        balances: [{ cash: -100 }],
      }),
    });

    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
    };

    await expect(calculateRequiredTrades(broker, 'acct-1', allocation)).rejects.toThrow(
      'Invalid cash balance data',
    );
  });

  it('skips cash equivalent positions', async () => {
    const broker = createMockBroker({
      getHoldings: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: { symbol: { id: '1', symbol: 'SPAXX', exchange: { mic_code: 'XNAS' } } },
            currency: { code: 'USD' },
            units: 1000,
            price: 1,
            cash_equivalent: true,
          },
        ],
        balances: [{ cash: 5000 }],
      }),
      getQuotes: vi.fn().mockResolvedValue([{ symbol: 'SPY', lastTradePrice: 100 }]),
    });

    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
    };

    const result = await calculateRequiredTrades(broker, 'acct-1', allocation);

    // Cash equivalent positions should not appear in current positions
    // Total value = $5000 (cash only), all of which should go to SPY
    expect(result.length).toBeGreaterThan(0);
    const buyOrder = result.find((o) => o.action === 'BUY' && o.symbol === 'SPY');
    expect(buyOrder).toBeDefined();
  });

  it('handles CASH target weight from DTB3', async () => {
    const broker = createMockBroker({
      getHoldings: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: { symbol: { id: '1', symbol: 'SPY', exchange: { mic_code: 'XNAS' } } },
            currency: { code: 'USD' },
            units: 100,
            price: 100,
          },
        ],
        balances: [{ cash: 0 }],
      }),
    });

    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [
        { ticker: { symbol: 'SPY', leverage: 1 }, weight: 50 },
        { ticker: { symbol: 'DTB3', leverage: 1 }, weight: 50 },
      ],
    };

    const result = await calculateRequiredTrades(broker, 'acct-1', allocation);

    // SPY = $10000, cash = $0, total = $10000. Target: SPY 50%, CASH 50%.
    // Drift = 50pp, triggers rebalance. Should sell SPY.
    const sellOrder = result.find((o) => o.action === 'SELL' && o.symbol === 'SPY');
    expect(sellOrder).toBeDefined();
  });

  it('aggregates positions with different identity keys but same symbol', async () => {
    const broker = createMockBroker({
      getHoldings: vi.fn().mockResolvedValue({
        positions: [
          {
            symbol: { symbol: { id: '1', symbol: 'SPY', exchange: { mic_code: 'XNAS' } } },
            currency: { code: 'USD' },
            units: 10,
            price: 100,
          },
          {
            symbol: { symbol: { id: '2', symbol: 'SPY', exchange: { mic_code: 'XNYS' } } },
            currency: { code: 'USD' },
            units: 10,
            price: 100,
          },
        ],
        balances: [{ cash: 0 }],
      }),
    });

    const allocation: Allocation = {
      condition: dummyCondition,
      holdings: [{ ticker: { symbol: 'SPY', leverage: 1 }, weight: 100 }],
    };

    // Should not throw — different identity keys
    const result = await calculateRequiredTrades(broker, 'acct-1', allocation);
    expect(Array.isArray(result)).toBe(true);
  });
});
