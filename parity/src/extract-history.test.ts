import { describe, it, expect } from 'vitest';
import { extractV3History, extractV4History } from './extract-history';

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

describe('extractV3History', () => {
  it('emits one entry per bar with weights from allocation.holdings', () => {
    const tk = (symbol: string) => ({ symbol, leverage: 1 }) as never;
    const bars = [
      { date: '2024-01-02', allocation: { holdings: [[tk('SPY'), 1.0]] } as never },
      {
        date: '2024-01-03',
        allocation: {
          holdings: [
            [tk('SPY'), 0.6],
            [tk('QQQ'), 0.4],
          ],
        } as never,
      },
    ];
    const hist = extractV3History(bars);
    expect(hist).toEqual([
      { date: '2024-01-02', weights: { 'us:SPY': 1.0 } },
      { date: '2024-01-03', weights: { 'us:SPY': 0.6, 'us:QQQ': 0.4 } },
    ]);
  });

  it('drops CASHX', () => {
    const tk = (symbol: string) => ({ symbol, leverage: 1 }) as never;
    const bars = [
      {
        date: '2024-01-02',
        allocation: {
          holdings: [
            [tk('SPY'), 0.7],
            [tk('CASHX'), 0.3],
          ],
        } as never,
      },
    ];
    const hist = extractV3History(bars);
    expect(hist[0]!.weights).toEqual({ 'us:SPY': 1.0 }); // 0.7 renormalized to 1.0 after dropping cash
  });

  it('honors custom symbolToAssetId', () => {
    const tk = (symbol: string) => ({ symbol, leverage: 1 }) as never;
    const bars = [{ date: '2024-01-02', allocation: { holdings: [[tk('SPY'), 1.0]] } as never }];
    const hist = extractV3History(bars, (s) => `nasdaq:${s}`);
    expect(hist[0]!.weights).toEqual({ 'nasdaq:SPY': 1.0 });
  });
});

describe('extractV4History', () => {
  it('computes target weights from positions × close price, normalized', () => {
    const result = {
      snapshots: [
        {
          t: utc('2024-01-02'),
          portfolio: {
            cash: 0,
            t: utc('2024-01-02'),
            positions: [
              {
                id: 'p1',
                asset: { kind: 'equity', id: 'us:SPY', symbol: 'SPY' },
                side: 'long',
                quantity: 60,
                basis: 6_000,
                entry: { date: utc('2024-01-02'), price: 100 },
              },
              {
                id: 'p2',
                asset: { kind: 'equity', id: 'us:QQQ', symbol: 'QQQ' },
                side: 'long',
                quantity: 40,
                basis: 4_000,
                entry: { date: utc('2024-01-02'), price: 100 },
              },
            ],
          },
          orders: [],
          fills: [],
        },
      ],
      finalPortfolio: { cash: 0, positions: [], t: utc('2024-01-02') },
    } as never;
    const priceAt = () => 100;
    const hist = extractV4History(result, priceAt);
    expect(hist[0]!.date).toBe('2024-01-02');
    expect(hist[0]!.weights['us:SPY']).toBeCloseTo(0.6, 8);
    expect(hist[0]!.weights['us:QQQ']).toBeCloseTo(0.4, 8);
  });

  it('emits empty weights when portfolio is all-cash', () => {
    const result = {
      snapshots: [
        {
          t: utc('2024-01-02'),
          portfolio: { cash: 100_000, t: utc('2024-01-02'), positions: [] },
          orders: [],
          fills: [],
        },
      ],
      finalPortfolio: { cash: 100_000, positions: [], t: utc('2024-01-02') },
    } as never;
    const hist = extractV4History(result, () => 100);
    expect(hist[0]!.weights).toEqual({});
  });
});
